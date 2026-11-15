//! TOTP enrollment, encrypted authenticator secrets, recovery codes, and login challenges.
use super::{hash_token, verify_password};
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, PublicUser, Tenant},
};
use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha1::Sha1;
use std::{
    env,
    time::{SystemTime, UNIX_EPOCH},
};
use subtle::ConstantTimeEq;
use uuid::Uuid;

const TOTP_STEP_SECONDS: u64 = 30;
const MFA_CHALLENGE_ATTEMPTS: i32 = 5;

fn user_id(actor: &Actor) -> R<&str> {
    match actor {
        Actor::User { id, .. } => Ok(id),
        Actor::System => Err(ApiError::forbidden("auth.mfa.user")),
    }
}

fn encryption_key() -> R<Vec<u8>> {
    let encoded = env::var("OSP_TOTP_ENCRYPTION_KEY").map_err(|_| {
        ApiError::new(
            503,
            "MFA_NOT_CONFIGURED",
            "Máy chủ chưa cấu hình khóa mã hóa cho bí mật xác thực hai lớp",
        )
    })?;
    let key = STANDARD.decode(encoded.trim()).map_err(|_| {
        ApiError::new(
            503,
            "MFA_NOT_CONFIGURED",
            "Khóa mã hóa xác thực hai lớp phải là Base64 của đúng 32 byte",
        )
    })?;
    if key.len() != 32 {
        return Err(ApiError::new(
            503,
            "MFA_NOT_CONFIGURED",
            "Khóa mã hóa xác thực hai lớp phải là Base64 của đúng 32 byte",
        ));
    }
    Ok(key)
}

fn aad(tenant_id: &str, user_id: &str) -> Vec<u8> {
    format!("osp:totp:{tenant_id}:{user_id}").into_bytes()
}

fn encrypt_secret(tenant_id: &str, user_id: &str, secret: &[u8]) -> R<(String, String)> {
    let key = encryption_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| ApiError::internal("Could not initialize TOTP encryption"))?;
    let nonce_bytes = Uuid::new_v4().into_bytes();
    let nonce = Nonce::from_slice(&nonce_bytes[..12]);
    let encrypted = cipher
        .encrypt(
            nonce,
            aes_gcm::aead::Payload {
                msg: secret,
                aad: &aad(tenant_id, user_id),
            },
        )
        .map_err(|_| ApiError::internal("Could not encrypt TOTP secret"))?;
    Ok((hex::encode(encrypted), hex::encode(&nonce_bytes[..12])))
}

fn decrypt_secret(tenant_id: &str, user_id: &str, ciphertext: &str, nonce: &str) -> R<Vec<u8>> {
    let key = encryption_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| ApiError::internal("Could not initialize TOTP encryption"))?;
    let ciphertext = hex::decode(ciphertext)
        .map_err(|_| ApiError::internal("Stored TOTP ciphertext is invalid"))?;
    let nonce =
        hex::decode(nonce).map_err(|_| ApiError::internal("Stored TOTP nonce is invalid"))?;
    if nonce.len() != 12 {
        return Err(ApiError::internal(
            "Stored TOTP nonce has an invalid length",
        ));
    }
    cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            aes_gcm::aead::Payload {
                msg: &ciphertext,
                aad: &aad(tenant_id, user_id),
            },
        )
        .map_err(|_| ApiError::internal("Could not decrypt stored TOTP secret"))
}

fn new_secret() -> Vec<u8> {
    let mut secret = Vec::with_capacity(20);
    secret.extend_from_slice(Uuid::new_v4().as_bytes());
    secret.extend_from_slice(Uuid::new_v4().as_bytes());
    secret.truncate(20);
    secret
}

fn base32(secret: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut result = String::new();
    let (mut buffer, mut bits) = (0_u32, 0_u8);
    for byte in secret {
        buffer = (buffer << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            result.push(ALPHABET[((buffer >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        result.push(ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    result
}

fn hotp(secret: &[u8], counter: u64) -> Option<[u8; 6]> {
    let mut mac = <Hmac<Sha1> as hmac::KeyInit>::new_from_slice(secret).ok()?;
    mac.update(&counter.to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = usize::from(digest[19] & 0x0f);
    let binary = (u32::from(digest[offset] & 0x7f) << 24)
        | (u32::from(digest[offset + 1]) << 16)
        | (u32::from(digest[offset + 2]) << 8)
        | u32::from(digest[offset + 3]);
    Some(
        format!("{:06}", binary % 1_000_000)
            .into_bytes()
            .try_into()
            .ok()?,
    )
}

fn matching_counter(secret: &[u8], code: &str, minimum_counter: i64) -> Option<i64> {
    if code.len() != 6 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    let current = now / TOTP_STEP_SECONDS;
    for candidate in [
        current.checked_sub(1),
        Some(current),
        current.checked_add(1),
    ]
    .into_iter()
    .flatten()
    {
        if candidate as i64 <= minimum_counter {
            continue;
        }
        if hotp(secret, candidate)
            .is_some_and(|expected| bool::from(code.as_bytes().ct_eq(expected.as_slice())))
        {
            return i64::try_from(candidate).ok();
        }
    }
    None
}

fn normalize_recovery_code(code: &str) -> String {
    code.chars()
        .filter(|character| !character.is_ascii_whitespace() && *character != '-')
        .flat_map(char::to_uppercase)
        .collect()
}

fn recovery_codes() -> (Vec<String>, Vec<String>) {
    let raw = (0..10)
        .map(|_| Uuid::new_v4().simple().to_string().to_ascii_uppercase())
        .collect::<Vec<_>>();
    let plaintext = raw
        .iter()
        .map(|code| {
            code.as_bytes()
                .chunks(4)
                .map(|chunk| std::str::from_utf8(chunk).unwrap_or_default())
                .collect::<Vec<_>>()
                .join("-")
        })
        .collect::<Vec<_>>();
    let hashes = raw.iter().map(|code| hash_token(code)).collect::<Vec<_>>();
    (plaintext, hashes)
}

fn invalid_code() -> ApiError {
    ApiError::new(
        401,
        "INVALID_MFA_CODE",
        "Mã xác thực không hợp lệ hoặc đã được sử dụng",
    )
}

pub async fn create_login_challenge(
    kernel: &Kernel,
    tenant: &Tenant,
    user_id: &str,
) -> R<Option<Value>> {
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    let row = tx
        .query_opt(
            "SELECT totp_enabled FROM osp_users WHERE tenant_id=$1 AND id=$2 AND disabled=false AND email_verified=true FOR UPDATE",
            &[&tenant.id, &user_id],
        )
        .await?;
    let Some(row) = row else {
        return Err(ApiError::new(
            401,
            "INVALID_CREDENTIALS",
            "Sai email hoặc mật khẩu",
        ));
    };
    if !row.get::<_, bool>(0) {
        tx.commit().await?;
        return Ok(None);
    }
    let (challenge, _, expires_at) = kernel
        .insert_token(
            &tx,
            &tenant.id,
            user_id,
            "mfa",
            Some("MFA login challenge"),
            Some(std::time::Duration::from_secs(5 * 60)),
            None,
        )
        .await?;
    kernel
        .audit_raw(&tx, &tenant.id, user_id, "login.mfa_required", None, None)
        .await?;
    tx.commit().await?;
    Ok(Some(
        json!({ "mfaRequired": true, "challengeToken": challenge, "expiresAt": expires_at }),
    ))
}

pub async fn complete_login(kernel: &Kernel, token: &str, code: &str) -> R<Value> {
    if !token.starts_with("osp_") || token.len() > 100 || code.len() > 100 {
        return Err(invalid_code());
    }
    let hash = hash_token(token);
    let locator = {
        let conn = kernel.pool.get().await?;
        conn.query_opt(
            "SELECT tenant_id,user_id FROM osp_sessions WHERE hash=$1 AND kind='mfa' AND expires_at>now()",
            &[&hash],
        )
        .await?
    };
    let Some(locator) = locator else {
        return Err(invalid_code());
    };
    let tenant_id: String = locator.get(0);
    let user_id: String = locator.get(1);
    let tenant = kernel.tenant(&tenant_id).await?;
    if tenant.suspended {
        return Err(ApiError::new(
            403,
            "TENANT_SUSPENDED",
            "Tài khoản doanh nghiệp đang bị tạm ngưng",
        ));
    }
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant_id, true).await?;
    let row = tx
        .query_opt(
            "SELECT s.attempts,u.name,u.email,u.roles,u.disabled,u.email_verified,u.password_hash IS NOT NULL,u.totp_enabled,u.totp_secret,u.totp_nonce,u.totp_last_counter,to_char(u.created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') FROM osp_sessions s JOIN osp_users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id WHERE s.hash=$1 AND s.tenant_id=$2 AND s.user_id=$3 AND s.kind='mfa' AND s.expires_at>now() FOR UPDATE OF s,u",
            &[&hash, &tenant_id, &user_id],
        )
        .await?;
    let Some(row) = row else {
        return Err(invalid_code());
    };
    if row.get::<_, i32>(0) >= MFA_CHALLENGE_ATTEMPTS
        || row.get::<_, bool>(4)
        || !row.get::<_, bool>(5)
        || !row.get::<_, bool>(7)
    {
        tx.execute("DELETE FROM osp_sessions WHERE hash=$1", &[&hash])
            .await?;
        tx.commit().await?;
        return Err(invalid_code());
    }
    let ciphertext: Option<String> = row.get(8);
    let nonce: Option<String> = row.get(9);
    let last_counter: i64 = row.get(10);
    let secret = match (ciphertext, nonce) {
        (Some(ciphertext), Some(nonce)) => {
            decrypt_secret(&tenant_id, &user_id, &ciphertext, &nonce)?
        }
        _ => {
            return Err(ApiError::internal(
                "Enabled MFA account has no encrypted TOTP secret",
            ));
        }
    };
    let normalized = normalize_recovery_code(code);
    let counter = matching_counter(&secret, code.trim(), last_counter);
    let mut recovery_hash = None;
    if counter.is_none() && normalized.len() == 32 {
        let recovery = hash_token(&normalized);
        if tx.query_opt(
            "SELECT code_hash FROM osp_user_recovery_codes WHERE tenant_id=$1 AND user_id=$2 AND code_hash=$3 AND used_at IS NULL FOR UPDATE",
            &[&tenant_id, &user_id, &recovery],
        ).await?.is_some() {
            recovery_hash = Some(recovery);
        }
    }
    if counter.is_none() && recovery_hash.is_none() {
        let attempts: i32 = tx
            .query_one_row(
                "UPDATE osp_sessions SET attempts=attempts+1 WHERE hash=$1 RETURNING attempts",
                &[&hash],
            )
            .await?
            .get(0);
        if attempts >= MFA_CHALLENGE_ATTEMPTS {
            tx.execute("DELETE FROM osp_sessions WHERE hash=$1", &[&hash])
                .await?;
        }
        kernel
            .audit_raw(&tx, &tenant_id, &user_id, "login.mfa_failed", None, None)
            .await?;
        tx.commit().await?;
        return Err(invalid_code());
    }
    if let Some(counter) = counter {
        tx.execute(
            "UPDATE osp_users SET totp_last_counter=$3 WHERE tenant_id=$1 AND id=$2",
            &[&tenant_id, &user_id, &counter],
        )
        .await?;
    }
    if let Some(recovery_hash) = recovery_hash {
        tx.execute(
            "UPDATE osp_user_recovery_codes SET used_at=now() WHERE tenant_id=$1 AND user_id=$2 AND code_hash=$3 AND used_at IS NULL",
            &[&tenant_id, &user_id, &recovery_hash],
        )
        .await?;
    }
    tx.execute("DELETE FROM osp_sessions WHERE hash=$1", &[&hash])
        .await?;
    let (session_token, _, expires_at) = kernel
        .insert_token(
            &tx,
            &tenant_id,
            &user_id,
            "session",
            Some("MFA login"),
            Some(kernel.cfg.session_ttl),
            None,
        )
        .await?;
    kernel
        .audit_raw(&tx, &tenant_id, &user_id, "login", None, Some("mfa".into()))
        .await?;
    tx.commit().await?;
    let user = PublicUser {
        id: user_id,
        name: row.get(1),
        email: row.get(2),
        roles: row.get(3),
        disabled: false,
        has_password: row.get(6),
        mfa_enabled: true,
        created_at: row.get(11),
    };
    Ok(
        json!({ "tenantId": tenant.id, "token": session_token, "expiresAt": expires_at, "user": user }),
    )
}

pub async fn status(kernel: &Kernel, tenant: &Tenant, actor: &Actor) -> R<Value> {
    let user_id = user_id(actor)?;
    let conn = kernel.pool.get().await?;
    let row = conn
        .query_opt(
            "SELECT u.totp_enabled,(SELECT count(*) FROM osp_user_recovery_codes r WHERE r.tenant_id=u.tenant_id AND r.user_id=u.id AND r.used_at IS NULL)::bigint FROM osp_users u WHERE u.tenant_id=$1 AND u.id=$2",
            &[&tenant.id, &user_id],
        )
        .await?
        .ok_or_else(|| ApiError::not_found("user"))?;
    Ok(json!({ "enabled": row.get::<_, bool>(0), "recoveryCodesRemaining": row.get::<_, i64>(1) }))
}

pub async fn setup_start(
    kernel: &Kernel,
    tenant: &Tenant,
    actor: &Actor,
    password: &str,
) -> R<Value> {
    let user_id = user_id(actor)?;
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    let row = tx
        .query_opt(
            "SELECT password_hash,totp_enabled,email FROM osp_users WHERE tenant_id=$1 AND id=$2 AND disabled=false AND email_verified=true FOR UPDATE",
            &[&tenant.id, &user_id],
        )
        .await?
        .ok_or_else(|| ApiError::not_found("user"))?;
    let password_hash: Option<String> = row.get(0);
    if !verify_password(password.to_owned(), password_hash).await {
        return Err(ApiError::new(401, "INVALID_CREDENTIALS", "Sai mật khẩu"));
    }
    if row.get::<_, bool>(1) {
        return Err(ApiError::new(
            409,
            "MFA_ALREADY_ENABLED",
            "Xác thực hai lớp đã được bật",
        ));
    }
    let secret = new_secret();
    let (ciphertext, nonce) = encrypt_secret(&tenant.id, user_id, &secret)?;
    tx.execute(
        "UPDATE osp_users SET totp_pending_secret=$3,totp_pending_nonce=$4,totp_pending_expires_at=now()+interval '10 minutes',totp_pending_attempts=0 WHERE tenant_id=$1 AND id=$2",
        &[&tenant.id, &user_id, &ciphertext, &nonce],
    )
    .await?;
    kernel
        .audit_raw(&tx, &tenant.id, user_id, "mfa.setup_started", None, None)
        .await?;
    tx.commit().await?;
    let secret_text = base32(&secret);
    let label = row
        .get::<_, Option<String>>(2)
        .unwrap_or_else(|| user_id.to_owned());
    let uri = format!(
        "otpauth://totp/OSP%20Suite%3A{}?secret={secret_text}&issuer=OSP%20Suite&algorithm=SHA1&digits=6&period=30",
        url::form_urlencoded::byte_serialize(label.as_bytes()).collect::<String>()
    );
    Ok(json!({ "secret": secret_text, "otpauthUrl": uri, "expiresInMinutes": 10 }))
}

pub async fn setup_confirm(
    kernel: &Kernel,
    tenant: &Tenant,
    actor: &Actor,
    code: &str,
    current_token: &str,
) -> R<Value> {
    let user_id = user_id(actor)?;
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    let row = tx
        .query_opt(
            "SELECT totp_enabled,totp_pending_secret,totp_pending_nonce,totp_pending_expires_at>now(),totp_pending_attempts FROM osp_users WHERE tenant_id=$1 AND id=$2 AND disabled=false FOR UPDATE",
            &[&tenant.id, &user_id],
        )
        .await?
        .ok_or_else(|| ApiError::not_found("user"))?;
    if row.get::<_, bool>(0)
        || !row.get::<_, Option<bool>>(3).unwrap_or(false)
        || row.get::<_, i32>(4) >= 5
    {
        return Err(ApiError::new(
            422,
            "MFA_SETUP_EXPIRED",
            "Quá trình thiết lập đã hết hạn; hãy bắt đầu lại",
        ));
    }
    let ciphertext: Option<String> = row.get(1);
    let nonce: Option<String> = row.get(2);
    let secret = match (ciphertext, nonce) {
        (Some(ciphertext), Some(nonce)) => {
            decrypt_secret(&tenant.id, user_id, &ciphertext, &nonce)?
        }
        _ => {
            return Err(ApiError::new(
                422,
                "MFA_SETUP_EXPIRED",
                "Quá trình thiết lập đã hết hạn; hãy bắt đầu lại",
            ));
        }
    };
    let Some(counter) = matching_counter(&secret, code.trim(), -1) else {
        let attempts: i32 = tx
            .query_one_row(
                "UPDATE osp_users SET totp_pending_attempts=totp_pending_attempts+1 WHERE tenant_id=$1 AND id=$2 RETURNING totp_pending_attempts",
                &[&tenant.id, &user_id],
            )
            .await?
            .get(0);
        if attempts >= 5 {
            tx.execute(
                "UPDATE osp_users SET totp_pending_secret=NULL,totp_pending_nonce=NULL,totp_pending_expires_at=NULL,totp_pending_attempts=0 WHERE tenant_id=$1 AND id=$2",
                &[&tenant.id, &user_id],
            )
            .await?;
        }
        kernel
            .audit_raw(&tx, &tenant.id, user_id, "mfa.setup_failed", None, None)
            .await?;
        tx.commit().await?;
        return Err(invalid_code());
    };
    let (codes, hashes) = recovery_codes();
    tx.execute(
        "DELETE FROM osp_user_recovery_codes WHERE tenant_id=$1 AND user_id=$2",
        &[&tenant.id, &user_id],
    )
    .await?;
    for hash in hashes {
        tx.execute(
            "INSERT INTO osp_user_recovery_codes(tenant_id,user_id,code_hash) VALUES($1,$2,$3)",
            &[&tenant.id, &user_id, &hash],
        )
        .await?;
    }
    tx.execute(
        "UPDATE osp_users SET totp_enabled=true,totp_secret=totp_pending_secret,totp_nonce=totp_pending_nonce,totp_pending_secret=NULL,totp_pending_nonce=NULL,totp_pending_expires_at=NULL,totp_pending_attempts=0,totp_last_counter=$3 WHERE tenant_id=$1 AND id=$2",
        &[&tenant.id, &user_id, &counter],
    )
    .await?;
    let current_hash = hash_token(current_token);
    tx.execute(
        "DELETE FROM osp_sessions WHERE tenant_id=$1 AND user_id=$2 AND kind IN ('session','api','mfa') AND NOT (hash=$3 AND kind='session')",
        &[&tenant.id, &user_id, &current_hash],
    )
    .await?;
    kernel
        .audit_raw(&tx, &tenant.id, user_id, "mfa.enabled", None, None)
        .await?;
    tx.commit().await?;
    Ok(json!({ "enabled": true, "recoveryCodes": codes }))
}

pub async fn disable(
    kernel: &Kernel,
    tenant: &Tenant,
    actor: &Actor,
    password: &str,
    code: &str,
    current_token: &str,
) -> R<()> {
    let user_id = user_id(actor)?;
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    let row = tx
        .query_opt(
            "SELECT password_hash,totp_enabled,totp_secret,totp_nonce,totp_last_counter,totp_disable_locked_until>now() FROM osp_users WHERE tenant_id=$1 AND id=$2 AND disabled=false FOR UPDATE",
            &[&tenant.id, &user_id],
        )
        .await?
        .ok_or_else(|| ApiError::not_found("user"))?;
    let password_hash: Option<String> = row.get(0);
    if !verify_password(password.to_owned(), password_hash).await {
        return Err(ApiError::new(401, "INVALID_CREDENTIALS", "Sai mật khẩu"));
    }
    if row.get::<_, Option<bool>>(5).unwrap_or(false) {
        return Err(ApiError::new(
            429,
            "MFA_RATE_LIMITED",
            "Quá nhiều mã sai; hãy thử lại sau 15 phút",
        ));
    }
    if !row.get::<_, bool>(1) {
        return Err(ApiError::new(
            409,
            "MFA_NOT_ENABLED",
            "Xác thực hai lớp chưa được bật",
        ));
    }
    let ciphertext: Option<String> = row.get(2);
    let nonce: Option<String> = row.get(3);
    let secret = match (ciphertext, nonce) {
        (Some(ciphertext), Some(nonce)) => {
            decrypt_secret(&tenant.id, user_id, &ciphertext, &nonce)?
        }
        _ => {
            return Err(ApiError::internal(
                "Enabled MFA account has no encrypted TOTP secret",
            ));
        }
    };
    let last_counter: i64 = row.get(4);
    let counter = matching_counter(&secret, code.trim(), last_counter);
    let normalized = normalize_recovery_code(code);
    let recovery = if counter.is_none() && normalized.len() == 32 {
        let hash = hash_token(&normalized);
        tx.query_opt(
            "SELECT code_hash FROM osp_user_recovery_codes WHERE tenant_id=$1 AND user_id=$2 AND code_hash=$3 AND used_at IS NULL FOR UPDATE",
            &[&tenant.id, &user_id, &hash],
        )
        .await?
        .map(|_| hash)
    } else {
        None
    };
    if counter.is_none() && recovery.is_none() {
        let attempts: i32 = tx
            .query_one_row(
                "UPDATE osp_users SET totp_disable_attempts=totp_disable_attempts+1 WHERE tenant_id=$1 AND id=$2 RETURNING totp_disable_attempts",
                &[&tenant.id, &user_id],
            )
            .await?
            .get(0);
        if attempts >= 5 {
            tx.execute(
                "UPDATE osp_users SET totp_disable_attempts=0,totp_disable_locked_until=now()+interval '15 minutes' WHERE tenant_id=$1 AND id=$2",
                &[&tenant.id, &user_id],
            )
            .await?;
        }
        kernel
            .audit_raw(&tx, &tenant.id, user_id, "mfa.disable_failed", None, None)
            .await?;
        tx.commit().await?;
        return Err(invalid_code());
    }
    if let Some(counter) = counter {
        tx.execute(
            "UPDATE osp_users SET totp_last_counter=$3 WHERE tenant_id=$1 AND id=$2",
            &[&tenant.id, &user_id, &counter],
        )
        .await?;
    }
    if let Some(hash) = recovery {
        tx.execute("UPDATE osp_user_recovery_codes SET used_at=now() WHERE tenant_id=$1 AND user_id=$2 AND code_hash=$3", &[&tenant.id, &user_id, &hash]).await?;
    }
    tx.execute(
        "UPDATE osp_users SET totp_disable_attempts=0,totp_disable_locked_until=NULL WHERE tenant_id=$1 AND id=$2",
        &[&tenant.id, &user_id],
    )
    .await?;
    tx.execute(
        "UPDATE osp_users SET totp_enabled=false,totp_secret=NULL,totp_nonce=NULL,totp_pending_secret=NULL,totp_pending_nonce=NULL,totp_pending_expires_at=NULL,totp_last_counter=-1 WHERE tenant_id=$1 AND id=$2",
        &[&tenant.id, &user_id],
    )
    .await?;
    tx.execute(
        "DELETE FROM osp_user_recovery_codes WHERE tenant_id=$1 AND user_id=$2",
        &[&tenant.id, &user_id],
    )
    .await?;
    let current_hash = hash_token(current_token);
    tx.execute(
        "DELETE FROM osp_sessions WHERE tenant_id=$1 AND user_id=$2 AND kind IN ('session','api','mfa') AND NOT (hash=$3 AND kind='session')",
        &[&tenant.id, &user_id, &current_hash],
    )
    .await?;
    kernel
        .audit_raw(&tx, &tenant.id, user_id, "mfa.disabled", None, None)
        .await?;
    tx.commit().await
}

pub async fn admin_reset(
    kernel: &Kernel,
    tenant: &Tenant,
    actor: &Actor,
    target_user_id: &str,
    reason: &str,
) -> R<()> {
    kernel.authorize(tenant, actor, "tenant.admin")?;
    let reason = reason.trim();
    if reason.chars().count() < 10 || reason.chars().count() > 500 {
        return Err(ApiError::validation(
            "auth.mfa.admin_reset",
            vec!["Nhập lý do đặt lại MFA từ 10 đến 500 ký tự".into()],
        ));
    }
    let mut conn = kernel.pool.get().await?;
    let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
    if tx
        .query_opt(
            "SELECT id FROM osp_users WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            &[&tenant.id, &target_user_id],
        )
        .await?
        .is_none()
    {
        return Err(ApiError::not_found("user"));
    }
    tx.execute(
        "UPDATE osp_users SET totp_enabled=false,totp_secret=NULL,totp_nonce=NULL,totp_pending_secret=NULL,totp_pending_nonce=NULL,totp_pending_expires_at=NULL,totp_pending_attempts=0,totp_last_counter=-1,totp_disable_attempts=0,totp_disable_locked_until=NULL WHERE tenant_id=$1 AND id=$2",
        &[&tenant.id, &target_user_id],
    )
    .await?;
    tx.execute(
        "DELETE FROM osp_user_recovery_codes WHERE tenant_id=$1 AND user_id=$2",
        &[&tenant.id, &target_user_id],
    )
    .await?;
    tx.execute(
        "DELETE FROM osp_sessions WHERE tenant_id=$1 AND user_id=$2",
        &[&tenant.id, &target_user_id],
    )
    .await?;
    kernel
        .audit_raw(
            &tx,
            &tenant.id,
            actor.user_id(),
            "mfa.admin_reset",
            Some(target_user_id),
            Some(reason.to_owned()),
        )
        .await?;
    tx.commit().await
}

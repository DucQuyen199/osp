//! Người dùng, mật khẩu (argon2id), phiên và API token (chỉ lưu băm SHA-256), vai trò.
use super::{Actor, Kernel, PublicUser, Tenant};
use crate::db::Tx;
use crate::defs::RoleDef;
use crate::error::{ApiError, R};
use argon2::{Algorithm, Argon2, Params, Version};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::env;
use std::sync::Arc;
use std::time::{Duration, Instant};
use subtle::ConstantTimeEq;
use uuid::Uuid;

pub(crate) mod mfa;
pub(crate) mod oidc;

const LOGIN_MAX_FAILS: u32 = 5;
const LOGIN_WINDOW: Duration = Duration::from_secs(15 * 60);

fn valid_api_scope(scope: &str) -> bool {
    if scope.len() > 160 {
        return false;
    }
    let parts: Vec<&str> = scope.split('.').collect();
    parts.len() == 3
        && parts[0] != "tenant"
        && parts.iter().all(|part| {
            *part == "*"
                || (!part.is_empty()
                    && part.bytes().all(|byte| {
                        byte.is_ascii_lowercase()
                            || byte.is_ascii_digit()
                            || matches!(byte, b'_' | b'-')
                    }))
        })
}

pub fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

pub fn new_token() -> String {
    format!("osp_{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn argon(m: u32, t: u32, p: u32) -> Argon2<'static> {
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(m, t, p, Some(32)).expect("tham số argon2"),
    )
}

/// Dạng lưu: argon2id$m=...,t=...,p=...$<salt hex>$<hash hex>
pub async fn hash_password(pw: String) -> R<String> {
    tokio::task::spawn_blocking(move || {
        let salt = Uuid::new_v4().into_bytes();
        let (m, t, p) = (19456, 2, 1);
        let mut out = [0u8; 32];
        argon(m, t, p)
            .hash_password_into(pw.as_bytes(), &salt, &mut out)
            .map_err(|e| ApiError::internal(e))?;
        Ok(format!(
            "argon2id$m={m},t={t},p={p}${}${}",
            hex::encode(salt),
            hex::encode(out)
        ))
    })
    .await
    .map_err(ApiError::internal)?
}

/// Luôn tốn thời gian tương đương kể cả khi không có băm (chống dò tài khoản qua thời gian phản hồi).
pub async fn verify_password(pw: String, stored: Option<String>) -> bool {
    tokio::task::spawn_blocking(move || {
        let dummy = "argon2id$m=19456,t=2,p=1$00000000000000000000000000000000$00".to_string();
        let has = stored.is_some();
        let s = stored.unwrap_or(dummy);
        let parts: Vec<&str> = s.split('$').collect();
        if parts.len() != 4 || parts[0] != "argon2id" {
            return false;
        }
        let params: Vec<u32> = parts[1]
            .split(',')
            .filter_map(|kv| kv.split('=').nth(1)?.parse().ok())
            .collect();
        let (Some(salt), Some(want), [m, t, p]) = (
            hex::decode(parts[2]).ok(),
            hex::decode(parts[3]).ok(),
            params.as_slice(),
        ) else {
            return false;
        };
        let mut got = [0u8; 32];
        if argon(*m, *t, *p)
            .hash_password_into(pw.as_bytes(), &salt, &mut got)
            .is_err()
        {
            return false;
        }
        has && want.len() == got.len() && bool::from(want.ct_eq(&got))
    })
    .await
    .unwrap_or(false)
}

pub fn check_password(pw: &str) -> R<()> {
    if pw.chars().count() < 8 {
        return Err(ApiError::new(
            422,
            "WEAK_PASSWORD",
            "Mật khẩu tối thiểu 8 ký tự",
        ));
    }
    if pw.len() > 200 {
        return Err(ApiError::new(422, "WEAK_PASSWORD", "Mật khẩu quá dài"));
    }
    Ok(())
}

fn valid_email(e: &str) -> bool {
    let mut parts = e.splitn(2, '@');
    match (parts.next(), parts.next()) {
        (Some(l), Some(d)) => {
            !l.is_empty()
                && d.contains('.')
                && !d.starts_with('.')
                && !d.ends_with('.')
                && !e.contains(char::is_whitespace)
        }
        _ => false,
    }
}

impl Kernel {
    pub async fn oidc_begin(&self, tenant_id: &str) -> R<Option<oidc::StartResult>> {
        let tenant = self.tenant(tenant_id).await?;
        if tenant.suspended {
            return Err(ApiError::new(
                403,
                "TENANT_SUSPENDED",
                "Doanh nghiệp đang bị tạm ngưng",
            ));
        }
        oidc::begin(tenant_id).await
    }

    pub async fn oidc_finish(
        &self,
        cookie: &str,
        code: &str,
        state: &str,
    ) -> R<Option<oidc::Identity>> {
        oidc::finish(cookie, code, state).await
    }

    pub(crate) async fn insert_user(
        &self,
        tx: &Tx<'_>,
        tenant: &str,
        name: &str,
        email: Option<&str>,
        password: Option<&str>,
        roles: &[String],
        known_roles: &std::collections::BTreeMap<String, RoleDef>,
    ) -> R<PublicUser> {
        for r in roles {
            if !known_roles.contains_key(r) {
                return Err(ApiError::new(
                    422,
                    "UNKNOWN_ROLE",
                    format!("Vai trò không tồn tại: {r}"),
                ));
            }
        }
        let email = email.map(|e| e.trim().to_lowercase());
        if let Some(e) = &email {
            if !valid_email(e) {
                return Err(ApiError::new(422, "BAD_EMAIL", "Email không hợp lệ"));
            }
            if tx
                .query_opt(
                    "SELECT 1 FROM osp_users WHERE tenant_id = $1 AND lower(email) = $2",
                    &[&tenant, e],
                )
                .await?
                .is_some()
            {
                return Err(ApiError::new(
                    409,
                    "EMAIL_TAKEN",
                    "Email đã được dùng trong doanh nghiệp này",
                ));
            }
        }
        let hash = match password {
            Some(p) => {
                check_password(p)?;
                Some(hash_password(p.to_string()).await?)
            }
            None => None,
        };
        let id = format!("u_{}", &Uuid::new_v4().simple().to_string()[..8]);
        let roles_vec: Vec<String> = roles.to_vec();
        let row = tx
            .query_one_row(
                "INSERT INTO osp_users (tenant_id, id, name, email, roles, password_hash) VALUES ($1, $2, $3, $4, $5, $6) \
                 RETURNING to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",
                &[&tenant, &id, &name, &email, &roles_vec, &hash],
            )
            .await?;
        Ok(PublicUser {
            id,
            name: name.to_string(),
            email,
            roles: roles_vec,
            disabled: false,
            has_password: hash.is_some(),
            mfa_enabled: false,
            created_at: row.get(0),
        })
    }

    pub(crate) async fn insert_token(
        &self,
        tx: &Tx<'_>,
        tenant: &str,
        user: &str,
        kind: &str,
        label: Option<&str>,
        ttl: Option<Duration>,
        scopes: Option<&[String]>,
    ) -> R<(String, String, Option<String>)> {
        let token = new_token();
        let hash = hash_token(&token);
        let secs = ttl
            .map(|duration| {
                i64::try_from(duration.as_secs()).map_err(|_| {
                    ApiError::validation(
                        "tenant.token",
                        vec!["Token lifetime exceeds the supported duration".into()],
                    )
                })
            })
            .transpose()?;
        let row = tx
            .query_one_row(
                "INSERT INTO osp_sessions (hash, tenant_id, user_id, kind, label, expires_at, scopes) \
                 VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::bigint IS NULL THEN NULL ELSE now() + (($6::bigint)::text || ' seconds')::interval END, $7) \
                 RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",
                &[&hash, &tenant, &user, &kind, &label, &secs, &scopes],
            )
            .await?;
        Ok((token, hash[..12].to_string(), row.get(0)))
    }

    pub async fn add_user(
        &self,
        t: &Tenant,
        name: &str,
        email: Option<&str>,
        password: Option<&str>,
        roles: &[String],
    ) -> R<(PublicUser, Option<String>)> {
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        let u = self
            .insert_user(&tx, &t.id, name, email, password, roles, &t.roles)
            .await?;
        let token = if password.is_none() {
            Some(
                self.insert_token(&tx, &t.id, &u.id, "api", Some("mặc định"), None, None)
                    .await?
                    .0,
            )
        } else {
            None
        };
        self.audit_raw(&tx, &t.id, "system", "user.create", Some(&u.id), None)
            .await?;
        tx.commit().await?;
        Ok((u, token))
    }

    pub async fn list_users(&self, t: &Tenant) -> R<Vec<PublicUser>> {
        let conn = self.pool.get().await?;
        let rows = conn
            .query(
                "SELECT id, name, email, roles, disabled, password_hash IS NOT NULL, totp_enabled, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') FROM osp_users WHERE tenant_id = $1 ORDER BY created_at, id",
                &[&t.id],
            )
            .await?;
        Ok(rows
            .into_iter()
            .map(|r| PublicUser {
                id: r.get(0),
                name: r.get(1),
                email: r.get(2),
                roles: r.get(3),
                disabled: r.get(4),
                has_password: r.get(5),
                mfa_enabled: r.get(6),
                created_at: r.get(7),
            })
            .collect())
    }

    pub async fn update_user(&self, t: &Tenant, id: &str, patch: &Value) -> R<PublicUser> {
        let users = self.list_users(t).await?;
        let cur = users.iter().find(|u| u.id == id).ok_or_else(|| {
            ApiError::new(404, "USER_NOT_FOUND", format!("Không có người dùng {id}"))
        })?;
        let roles: Vec<String> = match patch.get("roles") {
            Some(Value::Array(a)) => a
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect(),
            _ => cur.roles.clone(),
        };
        for r in &roles {
            if !t.roles.contains_key(r) {
                return Err(ApiError::new(
                    422,
                    "UNKNOWN_ROLE",
                    format!("Vai trò không tồn tại: {r}"),
                ));
            }
        }
        let disabled = patch
            .get("disabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(cur.disabled);
        let name = patch
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(&cur.name)
            .to_string();
        let admins = users
            .iter()
            .filter(|u| {
                let (r, d) = if u.id == id {
                    (&roles, disabled)
                } else {
                    (&u.roles, u.disabled)
                };
                r.iter().any(|x| x == "admin") && !d
            })
            .count();
        if admins == 0 {
            return Err(ApiError::new(
                409,
                "LAST_ADMIN",
                "Phải còn ít nhất một quản trị viên đang hoạt động",
            ));
        }
        let new_hash = match patch.get("password").and_then(|v| v.as_str()) {
            Some(p) => {
                check_password(p)?;
                Some(hash_password(p.to_string()).await?)
            }
            None => None,
        };
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        tx.execute("UPDATE osp_users SET name = $3, roles = $4, disabled = $5, password_hash = COALESCE($6, password_hash) WHERE tenant_id = $1 AND id = $2", &[&t.id, &id, &name, &roles, &disabled, &new_hash]).await?;
        if new_hash.is_some() {
            tx.execute("DELETE FROM osp_sessions WHERE tenant_id = $1 AND user_id = $2 AND kind = 'session'", &[&t.id, &id]).await?; // đổi mật khẩu => đăng xuất mọi phiên
        }
        if disabled {
            tx.execute(
                "DELETE FROM osp_sessions WHERE tenant_id = $1 AND user_id = $2",
                &[&t.id, &id],
            )
            .await?;
        }
        self.audit_raw(&tx, &t.id, "system", "user.update", Some(id), None)
            .await?;
        tx.commit().await?;
        let mut u = cur.clone();
        u.name = name;
        u.roles = roles;
        u.disabled = disabled;
        u.has_password = u.has_password || new_hash.is_some();
        Ok(u)
    }

    pub async fn add_role(
        &self,
        t: &Tenant,
        id: &str,
        name: &str,
        permissions: Vec<String>,
    ) -> R<()> {
        let ok = !id.is_empty()
            && id.chars().next().unwrap().is_ascii_lowercase()
            && id
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        if !ok {
            return Err(ApiError::new(
                422,
                "BAD_ROLE",
                "Mã vai trò: chữ thường, số, gạch dưới",
            ));
        }
        if id == "admin" {
            return Err(ApiError::new(409, "RESERVED", "Không sửa vai trò admin"));
        }
        if name.is_empty() {
            return Err(ApiError::new(422, "BAD_ROLE", "Cần name và permissions[]"));
        }
        let conn = self.pool.get().await?;
        conn.execute(
            "INSERT INTO osp_roles (tenant_id, id, name, permissions) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, permissions = EXCLUDED.permissions",
            &[&t.id, &id, &name, &permissions],
        )
        .await?;
        self.invalidate(&t.id);
        Ok(())
    }

    pub async fn issue_token(
        &self,
        t: &Tenant,
        user_id: &str,
        kind: &str,
        label: Option<&str>,
        ttl: Option<Duration>,
        scopes: Option<Vec<String>>,
    ) -> R<Value> {
        if kind == "scoped_api" {
            let valid = scopes.as_ref().is_some_and(|items| {
                !items.is_empty()
                    && items.len() <= 200
                    && items.iter().all(|scope| valid_api_scope(scope))
            });
            if !valid {
                return Err(ApiError::validation(
                    "tenant.token",
                    vec!["Scoped API tokens require 1 to 200 valid, non-administrative permission scopes".into()],
                ));
            }
        } else if scopes.is_some() {
            return Err(ApiError::validation(
                "tenant.token",
                vec!["Permission scopes are only supported for scoped_api tokens".into()],
            ));
        }
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        if tx
            .query_opt(
                "SELECT 1 FROM osp_users WHERE tenant_id = $1 AND id = $2",
                &[&t.id, &user_id],
            )
            .await?
            .is_none()
        {
            return Err(ApiError::new(
                404,
                "USER_NOT_FOUND",
                format!("Không có người dùng {user_id}"),
            ));
        }
        let (token, id, exp) = self
            .insert_token(&tx, &t.id, user_id, kind, label, ttl, scopes.as_deref())
            .await?;
        tx.commit().await?;
        Ok(json!({ "token": token, "id": id, "expiresAt": exp }))
    }

    pub async fn list_tokens(&self, t: &Tenant) -> R<Value> {
        let conn = self.pool.get().await?;
        let rows = conn
            .query(
                "SELECT jsonb_build_object('id', substr(hash, 1, 12), 'userId', user_id, 'kind', kind, 'label', label, 'createdAt', created_at, 'expiresAt', expires_at, 'scopes', scopes) \
                 FROM osp_sessions WHERE tenant_id = $1 AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC",
                &[&t.id],
            )
            .await?;
        Ok(Value::Array(
            rows.into_iter().map(|r| r.get::<_, Value>(0)).collect(),
        ))
    }

    pub async fn list_my_sessions(
        &self,
        t: &Tenant,
        actor: &Actor,
        current_token: &str,
    ) -> R<Value> {
        let user_id = match actor {
            Actor::User { id, .. } => id,
            Actor::System => return Err(ApiError::forbidden("auth.sessions.user")),
        };
        let current_hash = hash_token(current_token);
        let conn = self.pool.get().await?;
        let rows = conn
            .query(
                "SELECT jsonb_build_object('id', substr(hash, 1, 12), 'label', COALESCE(label, 'Browser session'), 'current', hash = $3, 'createdAt', created_at, 'expiresAt', expires_at) \
                 FROM osp_sessions WHERE tenant_id = $1 AND user_id = $2 AND kind = 'session' AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC",
                &[&t.id, user_id, &current_hash],
            )
            .await?;
        Ok(Value::Array(
            rows.into_iter().map(|row| row.get::<_, Value>(0)).collect(),
        ))
    }

    pub async fn revoke_other_sessions(
        &self,
        t: &Tenant,
        actor: &Actor,
        current_token: &str,
    ) -> R<u64> {
        let user_id = match actor {
            Actor::User { id, .. } => id,
            Actor::System => return Err(ApiError::forbidden("auth.sessions.user")),
        };
        let current_hash = hash_token(current_token);
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        let revoked = tx
            .execute(
                "DELETE FROM osp_sessions WHERE tenant_id = $1 AND user_id = $2 AND kind = 'session' AND hash <> $3",
                &[&t.id, user_id, &current_hash],
            )
            .await?;
        self.audit_raw(
            &tx,
            &t.id,
            user_id,
            "auth.sessions.revoke_others",
            None,
            Some(revoked.to_string()),
        )
        .await?;
        tx.commit().await?;
        Ok(revoked)
    }

    pub async fn revoke_token_by_id(&self, t: &Tenant, id: &str) -> R<bool> {
        if id.len() < 8 {
            return Ok(false);
        }
        let conn = self.pool.get().await?;
        let like = format!("{}%", id.replace(['%', '_'], ""));
        Ok(conn
            .execute(
                "DELETE FROM osp_sessions WHERE tenant_id = $1 AND hash LIKE $2",
                &[&t.id, &like],
            )
            .await?
            > 0)
    }

    pub async fn revoke_token(&self, token: &str) -> R<()> {
        let conn = self.pool.get().await?;
        conn.execute(
            "DELETE FROM osp_sessions WHERE hash = $1",
            &[&hash_token(token)],
        )
        .await?;
        Ok(())
    }

    /// Đăng nhập bằng email + mật khẩu => token phiên có hạn. Giới hạn 5 lần sai / 15 phút / tài khoản.
    pub async fn login(&self, tenant_id: &str, email: &str, password: &str) -> R<Value> {
        let key = format!("{tenant_id}|{}", email.to_lowercase());
        {
            let fails = self.login_fails.lock().unwrap();
            if let Some((n, at)) = fails.get(&key) {
                if at.elapsed() < LOGIN_WINDOW && *n >= LOGIN_MAX_FAILS {
                    return Err(ApiError::new(
                        429,
                        "TOO_MANY_ATTEMPTS",
                        "Sai quá nhiều lần. Thử lại sau ít phút.",
                    ));
                }
            }
        }
        let row = {
            let conn = self.pool.get().await?;
            conn.query_opt(
                "SELECT id, name, email, roles, disabled, password_hash, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'), email_verified, totp_enabled FROM osp_users WHERE tenant_id = $1 AND lower(email) = $2",
                &[&tenant_id, &email.to_lowercase()],
            )
            .await?
        };
        let (stored, disabled): (Option<String>, bool) = row
            .as_ref()
            .map(|r| (r.get(5), r.get(4)))
            .unwrap_or((None, true));
        let ok = verify_password(password.to_string(), stored).await && row.is_some() && !disabled;
        if !ok {
            {
                let mut fails = self.login_fails.lock().unwrap();
                let e = fails.entry(key).or_insert((0, Instant::now()));
                if e.1.elapsed() >= LOGIN_WINDOW {
                    *e = (0, Instant::now());
                }
                e.0 += 1;
            }
            if let Some(r) = &row {
                let mut conn = self.pool.get().await?;
                let uid: String = r.get(0);
                let tx = Tx::begin(&mut conn, &tenant_id, true).await?;
                self.audit_raw(
                    &tx,
                    &tenant_id,
                    &uid,
                    "login.fail",
                    None,
                    Some(email.to_string()),
                )
                .await?;
                tx.commit().await?;
            }
            return Err(ApiError::new(
                401,
                "INVALID_CREDENTIALS",
                "Sai email hoặc mật khẩu",
            ));
        }
        if !row.as_ref().is_some_and(|r| r.get::<_, bool>(7)) {
            return Err(ApiError::new(
                403,
                "EMAIL_NOT_VERIFIED",
                "Hãy xác minh email từ liên kết đã gửi trước khi đăng nhập",
            ));
        }
        let r = row.unwrap();
        let uid: String = r.get(0);
        let t = self.tenant(tenant_id).await?;
        if r.get::<_, bool>(8)
            && let Some(challenge) = mfa::create_login_challenge(self, &t, &uid).await?
        {
            self.login_fails.lock().unwrap().remove(&key);
            return Ok(challenge);
        }
        self.login_fails.lock().unwrap().remove(&key);
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &t.id, true).await?;
        let (token, _, exp) = self
            .insert_token(
                &tx,
                &t.id,
                &uid,
                "session",
                Some("đăng nhập"),
                Some(self.cfg.session_ttl),
                None,
            )
            .await?;
        self.audit_raw(&tx, &t.id, &uid, "login", None, None)
            .await?;
        tx.commit().await?;
        let user = PublicUser {
            id: uid,
            name: r.get(1),
            email: r.get(2),
            roles: r.get(3),
            disabled: false,
            has_password: true,
            mfa_enabled: false,
            created_at: r.get(6),
        };
        Ok(json!({ "token": token, "expiresAt": exp, "user": user }))
    }

    /// Complete a verified OIDC login. Existing users are linked by verified email once;
    /// later logins use the issuer/subject pair and remain valid if the provider changes email.
    pub async fn login_oidc(
        &self,
        tenant_id: &str,
        issuer: &str,
        subject: &str,
        email: &str,
    ) -> R<Value> {
        if tenant_id.is_empty()
            || issuer.is_empty()
            || subject.is_empty()
            || email.is_empty()
            || tenant_id.len() > 120
            || issuer.len() > 2048
            || subject.len() > 512
            || email.len() > 320
        {
            return Err(ApiError::new(
                401,
                "OIDC_LOGIN_FAILED",
                "Đăng nhập doanh nghiệp không hợp lệ",
            ));
        }
        let tenant = self.tenant(tenant_id).await?;
        if tenant.suspended {
            return Err(ApiError::new(
                403,
                "TENANT_SUSPENDED",
                "Doanh nghiệp đang bị tạm ngưng",
            ));
        }
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, tenant_id, true).await?;
        let query = "SELECT u.id,u.name,u.email,u.roles,u.disabled,u.email_verified,u.password_hash IS NOT NULL,u.totp_enabled,to_char(u.created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') FROM osp_user_identities i JOIN osp_users u ON u.tenant_id=i.tenant_id AND u.id=i.user_id WHERE i.tenant_id=$1 AND i.issuer=$2 AND i.subject=$3 FOR UPDATE OF u";
        let mut row = tx
            .query_opt(query, &[&tenant_id, &issuer, &subject])
            .await?;
        if row.is_none() {
            row = tx.query_opt(
                "SELECT id,name,email,roles,disabled,email_verified,password_hash IS NOT NULL,totp_enabled,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') FROM osp_users WHERE tenant_id=$1 AND lower(email)=$2 FOR UPDATE",
                &[&tenant_id, &email.to_lowercase()],
            ).await?;
            let Some(user) = row.as_ref() else {
                return Err(ApiError::new(
                    401,
                    "OIDC_ACCOUNT_NOT_LINKED",
                    "Tài khoản chưa được tạo trong doanh nghiệp này",
                ));
            };
            if user.get::<_, bool>(4)
                || !user.get::<_, bool>(5)
                || user
                    .get::<_, Option<String>>(2)
                    .as_deref()
                    .is_none_or(|value| value.to_lowercase() != email.to_lowercase())
            {
                return Err(ApiError::new(
                    401,
                    "OIDC_ACCOUNT_NOT_LINKED",
                    "Email chưa được xác minh hoặc tài khoản không hoạt động",
                ));
            }
            let user_id: String = user.get(0);
            tx.execute(
                "INSERT INTO osp_user_identities (tenant_id,user_id,issuer,subject) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,issuer,subject) DO NOTHING",
                &[&tenant_id, &user_id, &issuer, &subject],
            ).await?;
            let linked_user: Option<String> = tx.query_opt(
                "SELECT user_id FROM osp_user_identities WHERE tenant_id=$1 AND issuer=$2 AND subject=$3",
                &[&tenant_id, &issuer, &subject],
            ).await?.map(|identity| identity.get(0));
            if linked_user.as_deref() != Some(user_id.as_str()) {
                return Err(ApiError::new(
                    409,
                    "OIDC_IDENTITY_LINKED",
                    "Danh tính doanh nghiệp này đã được liên kết với tài khoản khác",
                ));
            }
        }
        let user = row.expect("OIDC account row is present after verified link");
        if user.get::<_, bool>(4) || !user.get::<_, bool>(5) {
            return Err(ApiError::new(
                401,
                "OIDC_ACCOUNT_NOT_LINKED",
                "Email chưa được xác minh hoặc tài khoản không hoạt động",
            ));
        }
        let user_id: String = user.get(0);
        let mfa_enabled: bool = user.get(7);
        if mfa_enabled {
            tx.commit().await?;
            let challenge = mfa::create_login_challenge(self, &tenant, &user_id)
                .await?
                .ok_or_else(|| {
                    ApiError::new(
                        401,
                        "OIDC_LOGIN_FAILED",
                        "Không thể tạo thử thách xác thực đa yếu tố",
                    )
                })?;
            let mut result = challenge;
            result["tenantId"] = json!(tenant.id);
            return Ok(result);
        }
        let (token, _, expires_at) = self
            .insert_token(
                &tx,
                &tenant.id,
                &user_id,
                "session",
                Some("OIDC login"),
                Some(self.cfg.session_ttl),
                None,
            )
            .await?;
        self.audit_raw(
            &tx,
            &tenant.id,
            &user_id,
            "login",
            None,
            Some("oidc".into()),
        )
        .await?;
        tx.commit().await?;
        let public_user = PublicUser {
            id: user_id,
            name: user.get(1),
            email: user.get(2),
            roles: user.get(3),
            disabled: false,
            has_password: user.get(6),
            mfa_enabled: false,
            created_at: user.get(8),
        };
        Ok(
            json!({ "tenantId": tenant.id, "token": token, "expiresAt": expires_at, "user": public_user }),
        )
    }

    /// Queue a generic, one-time password reset email without revealing whether the account exists.
    pub async fn request_password_reset(&self, tenant_id: &str, email: &str) -> R<()> {
        let normalized = email.trim().to_lowercase();
        if !valid_email(&normalized) {
            return Ok(());
        }
        let origin = env::var("OSP_PUBLIC_URL")
            .unwrap_or_default()
            .trim()
            .trim_end_matches('/')
            .to_owned();
        let local_http = origin.starts_with("http://localhost")
            || origin.starts_with("http://127.0.0.1")
            || origin.starts_with("http://[::1]");
        if origin.is_empty() || (!origin.starts_with("https://") && !local_http) {
            return Ok(());
        }
        let Some(tenant) = self.tenant(tenant_id).await.ok() else {
            return Ok(());
        };
        if tenant.suspended {
            return Ok(());
        }
        let user = {
            let conn = self.pool.get().await?;
            conn.query_opt(
                "SELECT id, email FROM osp_users WHERE tenant_id = $1 AND lower(email) = $2 AND disabled = false AND email_verified = true",
                &[&tenant.id, &normalized],
            )
            .await?
        };
        let Some(user) = user else {
            return Ok(());
        };
        let user_id: String = user.get(0);
        let recipient: String = user.get(1);
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
        let recent: i64 = tx
            .query_opt(
                "SELECT count(*) FROM osp_auth_mail_outbox WHERE tenant_id = $1 AND user_id = $2 AND created_at > now() - interval '1 hour'",
                &[&tenant.id, &user_id],
            )
            .await?
            .map(|row| row.get(0))
            .unwrap_or_default();
        if recent >= 3 {
            tx.commit().await?;
            return Ok(());
        }
        tx.execute(
            "UPDATE osp_auth_mail_outbox SET status = 'failed', body = '', last_error = 'superseded by a newer reset request', updated_at = now() WHERE tenant_id = $1 AND user_id = $2 AND status IN ('queued', 'retry', 'processing')",
            &[&tenant.id, &user_id],
        )
        .await?;
        tx.execute(
            "DELETE FROM osp_sessions WHERE tenant_id = $1 AND user_id = $2 AND kind = 'reset'",
            &[&tenant.id, &user_id],
        )
        .await?;
        let (token, _, _) = self
            .insert_token(
                &tx,
                &tenant.id,
                &user_id,
                "reset",
                Some("password reset"),
                Some(Duration::from_secs(30 * 60)),
                None,
            )
            .await?;
        let reset_url = format!("{origin}/#/reset-password/{token}");
        let subject = "Đặt lại mật khẩu OSP Suite";
        let body = format!(
            "Bạn đã yêu cầu đặt lại mật khẩu. Mở liên kết sau trong vòng 30 phút:\n\n{reset_url}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này."
        );
        tx.execute(
            "INSERT INTO osp_auth_mail_outbox (id, tenant_id, user_id, recipient, subject, body) VALUES ($1, $2, $3, $4, $5, $6)",
            &[&Uuid::new_v4(), &tenant.id, &user_id, &recipient, &subject, &body],
        )
        .await?;
        self.audit_raw(
            &tx,
            &tenant.id,
            "system",
            "password.reset_requested",
            Some(&user_id),
            None,
        )
        .await?;
        tx.commit().await
    }

    /// Resend a signup verification message without disclosing account state.
    pub async fn request_email_verification(&self, tenant_id: &str, email: &str) -> R<()> {
        let normalized = email.trim().to_lowercase();
        if !valid_email(&normalized) {
            return Ok(());
        }
        let origin = env::var("OSP_PUBLIC_URL").unwrap_or_default();
        let origin = origin.trim().trim_end_matches('/').to_owned();
        let local_http = origin.starts_with("http://localhost")
            || origin.starts_with("http://127.0.0.1")
            || origin.starts_with("http://[::1]");
        if origin.is_empty() || (!origin.starts_with("https://") && !local_http) {
            return Ok(());
        }
        let Some(tenant) = self.tenant(tenant_id).await.ok() else {
            return Ok(());
        };
        if tenant.suspended {
            return Ok(());
        }
        let user = {
            let conn = self.pool.get().await?;
            conn.query_opt("SELECT id, email FROM osp_users WHERE tenant_id = $1 AND lower(email) = $2 AND disabled = false AND email_verified = false", &[&tenant.id, &normalized]).await?
        };
        let Some(user) = user else {
            return Ok(());
        };
        let user_id: String = user.get(0);
        let recipient: String = user.get(1);
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, true).await?;
        let recent: i64 = tx.query_opt("SELECT count(*) FROM osp_auth_mail_outbox WHERE tenant_id = $1 AND user_id = $2 AND subject = 'Xác minh email OSP Suite' AND created_at > now() - interval '1 hour'", &[&tenant.id, &user_id]).await?.map(|row| row.get(0)).unwrap_or_default();
        if recent >= 3 {
            tx.commit().await?;
            return Ok(());
        }
        tx.execute("UPDATE osp_auth_mail_outbox SET status = 'failed', body = '', last_error = 'superseded by a newer verification request', updated_at = now() WHERE tenant_id = $1 AND user_id = $2 AND subject = 'Xác minh email OSP Suite' AND status IN ('queued', 'retry', 'processing')", &[&tenant.id, &user_id]).await?;
        tx.execute("DELETE FROM osp_sessions WHERE tenant_id = $1 AND user_id = $2 AND kind = 'verify_email'", &[&tenant.id, &user_id]).await?;
        let (token, _, _) = self
            .insert_token(
                &tx,
                &tenant.id,
                &user_id,
                "verify_email",
                Some("email verification"),
                Some(Duration::from_secs(24 * 60 * 60)),
                None,
            )
            .await?;
        let verify_url = format!("{origin}/#/verify-email/{token}");
        let subject = "Xác minh email OSP Suite";
        let body = format!(
            "Xác minh địa chỉ email để kích hoạt tài khoản quản trị (liên kết có hiệu lực 24 giờ):\n\n{verify_url}\n\nNếu bạn không tạo tài khoản này, hãy bỏ qua email."
        );
        tx.execute("INSERT INTO osp_auth_mail_outbox (id, tenant_id, user_id, recipient, subject, body) VALUES ($1, $2, $3, $4, $5, $6)", &[&Uuid::new_v4(), &tenant.id, &user_id, &recipient, &subject, &body]).await?;
        self.audit_raw(
            &tx,
            &tenant.id,
            &user_id,
            "email.verification_requested",
            Some(&user_id),
            None,
        )
        .await?;
        tx.commit().await
    }

    /// Consume a reset token once, change the password, and revoke browser sessions atomically.
    pub async fn complete_password_reset(&self, token: &str, password: &str) -> R<()> {
        check_password(password)?;
        if !token.starts_with("osp_") {
            return Err(ApiError::new(
                422,
                "INVALID_RESET_TOKEN",
                "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn",
            ));
        }
        let hash = hash_token(token);
        let locator = {
            let conn = self.pool.get().await?;
            conn.query_opt(
                "SELECT tenant_id, user_id FROM osp_sessions WHERE hash = $1 AND kind = 'reset' AND expires_at > now()",
                &[&hash],
            )
            .await?
        };
        let Some(locator) = locator else {
            return Err(ApiError::new(
                422,
                "INVALID_RESET_TOKEN",
                "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn",
            ));
        };
        let tenant_id: String = locator.get(0);
        let user_id: String = locator.get(1);
        let password_hash = hash_password(password.to_owned()).await?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant_id, true).await?;
        let valid = tx
            .query_opt(
                "SELECT s.user_id FROM osp_sessions s JOIN osp_users u ON u.tenant_id = s.tenant_id AND u.id = s.user_id WHERE s.hash = $1 AND s.tenant_id = $2 AND s.kind = 'reset' AND s.expires_at > now() AND u.disabled = false FOR UPDATE OF s, u",
                &[&hash, &tenant_id],
            )
            .await?
            .is_some_and(|row| row.get::<_, String>(0) == user_id);
        if !valid {
            return Err(ApiError::new(
                422,
                "INVALID_RESET_TOKEN",
                "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn",
            ));
        }
        tx.execute(
            "UPDATE osp_users SET password_hash = $3 WHERE tenant_id = $1 AND id = $2",
            &[&tenant_id, &user_id, &password_hash],
        )
        .await?;
        tx.execute(
            "DELETE FROM osp_sessions WHERE tenant_id = $1 AND user_id = $2 AND kind IN ('reset', 'session', 'api')",
            &[&tenant_id, &user_id],
        )
        .await?;
        tx.execute(
            "UPDATE osp_auth_mail_outbox SET status = 'failed', body = '', last_error = 'password reset completed', updated_at = now() WHERE tenant_id = $1 AND user_id = $2 AND status IN ('queued', 'retry', 'processing')",
            &[&tenant_id, &user_id],
        )
        .await?;
        self.audit_raw(
            &tx,
            &tenant_id,
            &user_id,
            "password.reset_completed",
            Some(&user_id),
            None,
        )
        .await?;
        tx.commit().await
    }

    /// Consume a one-time verification token and activate the account email.
    pub async fn complete_email_verification(&self, token: &str) -> R<()> {
        if !token.starts_with("osp_") {
            return Err(ApiError::new(
                422,
                "INVALID_VERIFICATION_TOKEN",
                "Liên kết xác minh không hợp lệ hoặc đã hết hạn",
            ));
        }
        let hash = hash_token(token);
        let locator = {
            let conn = self.pool.get().await?;
            conn.query_opt("SELECT tenant_id, user_id FROM osp_sessions WHERE hash = $1 AND kind = 'verify_email' AND expires_at > now()", &[&hash]).await?
        };
        let Some(locator) = locator else {
            return Err(ApiError::new(
                422,
                "INVALID_VERIFICATION_TOKEN",
                "Liên kết xác minh không hợp lệ hoặc đã hết hạn",
            ));
        };
        let tenant_id: String = locator.get(0);
        let user_id: String = locator.get(1);
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant_id, true).await?;
        let valid = tx.query_opt("SELECT s.user_id FROM osp_sessions s JOIN osp_users u ON u.tenant_id = s.tenant_id AND u.id = s.user_id WHERE s.hash = $1 AND s.tenant_id = $2 AND s.kind = 'verify_email' AND s.expires_at > now() AND u.disabled = false FOR UPDATE OF s, u", &[&hash, &tenant_id]).await?.is_some_and(|row| row.get::<_, String>(0) == user_id);
        if !valid {
            return Err(ApiError::new(
                422,
                "INVALID_VERIFICATION_TOKEN",
                "Liên kết xác minh không hợp lệ hoặc đã hết hạn",
            ));
        }
        tx.execute(
            "UPDATE osp_users SET email_verified = true WHERE tenant_id = $1 AND id = $2",
            &[&tenant_id, &user_id],
        )
        .await?;
        tx.execute("DELETE FROM osp_sessions WHERE tenant_id = $1 AND user_id = $2 AND kind = 'verify_email'", &[&tenant_id, &user_id]).await?;
        self.audit_raw(
            &tx,
            &tenant_id,
            &user_id,
            "email.verified",
            Some(&user_id),
            None,
        )
        .await?;
        tx.commit().await
    }

    /// Token -> (tenant, actor, user). None nếu sai/hết hạn/tài khoản bị khóa/tenant bị tạm ngưng.
    pub async fn authenticate(&self, token: &str) -> Option<(Arc<Tenant>, Actor, PublicUser)> {
        let conn = self.pool.get().await.ok()?;
        let row = conn
            .query_opt(
                "SELECT s.tenant_id, u.id, u.name, u.email, u.roles, u.disabled, u.password_hash IS NOT NULL, u.totp_enabled, to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'), s.kind, s.scopes \
                 FROM osp_sessions s JOIN osp_users u ON u.tenant_id = s.tenant_id AND u.id = s.user_id \
                 WHERE s.hash = $1 AND s.kind NOT IN ('reset', 'verify_email', 'mfa') AND u.email_verified = true AND (s.expires_at IS NULL OR s.expires_at > now())",
                &[&hash_token(token)],
            )
            .await
            .ok()??;
        if row.get::<_, bool>(5) {
            return None;
        }
        let tenant = self.tenant(row.get::<_, String>(0).as_str()).await.ok()?;
        let scoped = row.get::<_, String>(9) == "scoped_api";
        let roles = if scoped { Vec::new() } else { row.get(4) };
        let scopes: Option<Vec<String>> = if scoped {
            Some(row.get::<_, Option<Vec<String>>>(10).unwrap_or_default())
        } else {
            None
        };
        let user = PublicUser {
            id: row.get(1),
            name: row.get(2),
            email: row.get(3),
            roles: roles.clone(),
            disabled: false,
            has_password: row.get(6),
            mfa_enabled: row.get(7),
            created_at: row.get(8),
        };
        let actor = Actor::User {
            id: user.id.clone(),
            roles,
            scopes,
        };
        Some((tenant, actor, user))
    }
}

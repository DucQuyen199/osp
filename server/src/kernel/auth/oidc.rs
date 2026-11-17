//! OpenID Connect authorization-code flow with PKCE and an encrypted, short-lived state cookie.
use crate::error::{ApiError, R};
use aes_gcm::{
    Aes256Gcm, Nonce as AeadNonce,
    aead::{Aead, KeyInit},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use openidconnect::core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata};
use openidconnect::{
    AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl, Nonce, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, Scope, TokenResponse,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use url::Url;
use uuid::Uuid;

const COOKIE_NAME: &str = "osp_oidc";
const FLOW_MAX_AGE: u64 = 300;

#[derive(Clone)]
struct Config {
    issuer: String,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct FlowState {
    tenant_id: String,
    state: String,
    nonce: String,
    pkce_verifier: String,
    expires_at: i64,
}

pub struct StartResult {
    pub authorization_url: String,
    pub set_cookie: String,
}

pub struct Identity {
    pub tenant_id: String,
    pub issuer: String,
    pub subject: String,
    pub email: String,
}

fn config() -> R<Option<Config>> {
    let issuer = std::env::var("OSP_OIDC_ISSUER_URL").ok();
    let client_id = std::env::var("OSP_OIDC_CLIENT_ID").ok();
    let client_secret = std::env::var("OSP_OIDC_CLIENT_SECRET").ok();
    let redirect_uri = std::env::var("OSP_OIDC_REDIRECT_URI").ok();
    let configured = [
        issuer.is_some(),
        client_id.is_some(),
        client_secret.is_some(),
        redirect_uri.is_some(),
    ];
    if configured.iter().all(|value| !value) {
        return Ok(None);
    }
    if configured.iter().any(|value| !value) {
        return Err(ApiError::internal(
            "OIDC requires issuer URL, client ID, client secret, and redirect URI",
        ));
    }
    let issuer = issuer.unwrap().trim().to_owned();
    let redirect_uri = redirect_uri.unwrap().trim().to_owned();
    let issuer_url = Url::parse(&issuer).map_err(ApiError::internal)?;
    let redirect_url = Url::parse(&redirect_uri).map_err(ApiError::internal)?;
    if issuer_url.scheme() != "https"
        || issuer_url.query().is_some()
        || issuer_url.fragment().is_some()
    {
        return Err(ApiError::internal(
            "OIDC issuer must be an HTTPS URL without query or fragment",
        ));
    }
    if !matches!(redirect_url.scheme(), "https" | "http")
        || redirect_url.host_str().is_none()
        || redirect_url.fragment().is_some()
        || (redirect_url.scheme() != "https"
            && !redirect_url
                .host_str()
                .is_some_and(|host| matches!(host, "localhost" | "127.0.0.1" | "[::1]")))
    {
        return Err(ApiError::internal(
            "OIDC redirect URI must use HTTPS (HTTP is allowed only for localhost) and have no fragment",
        ));
    }
    let client_secret = client_secret.unwrap();
    let client_id = client_id.unwrap().trim().to_owned();
    if client_id.is_empty() {
        return Err(ApiError::internal("OIDC client ID must not be empty"));
    }
    if client_secret.len() < 32 {
        return Err(ApiError::internal(
            "OIDC client secret must contain at least 32 bytes",
        ));
    }
    Ok(Some(Config {
        issuer,
        client_id,
        client_secret,
        redirect_uri,
    }))
}

pub fn enabled() -> bool {
    config().is_ok_and(|value| value.is_some())
}

fn http_client() -> R<openidconnect::reqwest::Client> {
    openidconnect::reqwest::ClientBuilder::new()
        .redirect(openidconnect::reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(ApiError::internal)
}

pub async fn begin(tenant_id: &str) -> R<Option<StartResult>> {
    if tenant_id.is_empty() || tenant_id.len() > 120 || tenant_id.chars().any(char::is_control) {
        return Err(ApiError::new(
            422,
            "INVALID_TENANT",
            "Mã doanh nghiệp không hợp lệ",
        ));
    }
    let Some(config) = config()? else {
        return Ok(None);
    };
    let http = http_client()?;
    let issuer = IssuerUrl::new(config.issuer.clone()).map_err(ApiError::internal)?;
    let metadata = CoreProviderMetadata::discover_async(issuer, &http)
        .await
        .map_err(ApiError::internal)?;
    let client = CoreClient::from_provider_metadata(
        metadata,
        ClientId::new(config.client_id.clone()),
        Some(ClientSecret::new(config.client_secret.clone())),
    )
    .set_redirect_uri(RedirectUrl::new(config.redirect_uri.clone()).map_err(ApiError::internal)?);
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let (authorization_url, csrf, nonce) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("openid".into()))
        .add_scope(Scope::new("email".into()))
        .set_pkce_challenge(challenge)
        .url();
    let state = FlowState {
        tenant_id: tenant_id.to_owned(),
        state: csrf.secret().to_owned(),
        nonce: nonce.secret().to_owned(),
        pkce_verifier: verifier.secret().to_owned(),
        expires_at: chrono::Utc::now().timestamp() + FLOW_MAX_AGE as i64,
    };
    let cookie = encrypt_state(&config.client_secret, &state)?;
    let secure = Url::parse(&config.redirect_uri).is_ok_and(|url| url.scheme() == "https");
    let set_cookie = format!(
        "{COOKIE_NAME}={cookie}; Max-Age={FLOW_MAX_AGE}; Path=/api/auth/oidc; HttpOnly; SameSite=Lax{}",
        if secure { "; Secure" } else { "" }
    );
    Ok(Some(StartResult {
        authorization_url: authorization_url.to_string(),
        set_cookie,
    }))
}

pub async fn finish(cookie: &str, code: &str, state: &str) -> R<Option<Identity>> {
    if code.is_empty() || code.len() > 4096 || state.is_empty() || state.len() > 2048 {
        return Err(invalid_flow());
    }
    let Some(config) = config()? else {
        return Ok(None);
    };
    let flow = decrypt_state(&config.client_secret, cookie)?;
    if flow.expires_at < chrono::Utc::now().timestamp()
        || !bool::from(flow.state.as_bytes().ct_eq(state.as_bytes()))
    {
        return Err(invalid_flow());
    }
    let http = http_client()?;
    let issuer = IssuerUrl::new(config.issuer.clone()).map_err(ApiError::internal)?;
    let metadata = CoreProviderMetadata::discover_async(issuer, &http)
        .await
        .map_err(ApiError::internal)?;
    let client = CoreClient::from_provider_metadata(
        metadata,
        ClientId::new(config.client_id.clone()),
        Some(ClientSecret::new(config.client_secret.clone())),
    )
    .set_redirect_uri(RedirectUrl::new(config.redirect_uri.clone()).map_err(ApiError::internal)?);
    let response = client
        .exchange_code(AuthorizationCode::new(code.to_owned()))
        .map_err(|_| invalid_flow())?
        .set_pkce_verifier(PkceCodeVerifier::new(flow.pkce_verifier))
        .request_async(&http)
        .await
        .map_err(|_| invalid_flow())?;
    let id_token = response.id_token().ok_or_else(invalid_flow)?;
    let nonce = Nonce::new(flow.nonce);
    let claims = id_token
        .claims(&client.id_token_verifier(), &nonce)
        .map_err(|_| invalid_flow())?;
    let email_verified = claims.email_verified().unwrap_or(false);
    let email = claims
        .email()
        .map(|email| email.as_str().trim().to_lowercase());
    let Some(email) = email.filter(|email| email_verified && valid_email(email)) else {
        return Err(ApiError::new(
            403,
            "OIDC_EMAIL_UNVERIFIED",
            "Nhà cung cấp chưa xác minh email cho tài khoản này",
        ));
    };
    Ok(Some(Identity {
        tenant_id: flow.tenant_id,
        issuer: claims.issuer().as_str().to_owned(),
        subject: claims.subject().as_str().to_owned(),
        email,
    }))
}

pub fn clear_cookie() -> String {
    format!("{COOKIE_NAME}=; Max-Age=0; Path=/api/auth/oidc; HttpOnly; SameSite=Lax")
}

fn encrypt_state(secret: &str, state: &FlowState) -> R<String> {
    let cipher = cipher(secret);
    let nonce_bytes = Uuid::new_v4().into_bytes();
    let nonce = AeadNonce::from_slice(&nonce_bytes[..12]);
    let plaintext = serde_json::to_vec(state).map_err(ApiError::internal)?;
    let encrypted = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(ApiError::internal)?;
    let mut value = nonce_bytes[..12].to_vec();
    value.extend(encrypted);
    Ok(URL_SAFE_NO_PAD.encode(value))
}

fn decrypt_state(secret: &str, value: &str) -> R<FlowState> {
    let bytes = URL_SAFE_NO_PAD.decode(value).map_err(|_| invalid_flow())?;
    if bytes.len() <= 12 {
        return Err(invalid_flow());
    }
    let plaintext = cipher(secret)
        .decrypt(AeadNonce::from_slice(&bytes[..12]), &bytes[12..])
        .map_err(|_| invalid_flow())?;
    serde_json::from_slice(&plaintext).map_err(|_| invalid_flow())
}

fn cipher(secret: &str) -> Aes256Gcm {
    let digest =
        Sha256::digest([b"OSP OIDC state cookie v1\0".as_slice(), secret.as_bytes()].concat());
    Aes256Gcm::new_from_slice(&digest).expect("SHA-256 always produces a 256-bit key")
}

fn valid_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !email.chars().any(char::is_whitespace)
}

fn invalid_flow() -> ApiError {
    ApiError::new(
        401,
        "OIDC_LOGIN_FAILED",
        "Đăng nhập doanh nghiệp không hợp lệ hoặc đã hết hạn",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flow() -> FlowState {
        FlowState {
            tenant_id: "t_demo".into(),
            state: "csrf".into(),
            nonce: "nonce".into(),
            pkce_verifier: "verifier".into(),
            expires_at: chrono::Utc::now().timestamp() + 300,
        }
    }

    #[test]
    fn encrypted_state_cookie_round_trips_and_rejects_tampering() {
        let value =
            encrypt_state("a sufficiently long confidential provider secret", &flow()).unwrap();
        let parsed =
            decrypt_state("a sufficiently long confidential provider secret", &value).unwrap();
        assert_eq!(parsed.tenant_id, "t_demo");
        assert!(decrypt_state("a different sufficiently long secret", &value).is_err());
        let mut bytes = URL_SAFE_NO_PAD.decode(value).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        assert!(
            decrypt_state(
                "a sufficiently long confidential provider secret",
                &URL_SAFE_NO_PAD.encode(bytes)
            )
            .is_err()
        );
    }

    #[test]
    fn email_validation_rejects_unusable_claim_values() {
        assert!(valid_email("user@example.com"));
        assert!(!valid_email("user@localhost"));
        assert!(!valid_email("bad address@example.com"));
    }
}

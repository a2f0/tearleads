use std::{env, sync::OnceLock, time::Duration};

use base64::Engine as _;
use chrono::{DateTime, Utc};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use prost_types::Timestamp;
use regex::Regex;
use scrypt::{Params as ScryptParams, scrypt};
use serde::{Deserialize, Serialize};
use tearleads_api_v2_contracts::tearleads::v2::{AuthSessionSummary, AuthVfsKeySetup};
use tearleads_data_access_traits::{
    AuthSession, AuthVfsKeySetupInput, DataAccessError, DataAccessErrorKind,
};
use tonic::{
    Code, Status,
    metadata::{MetadataMap, MetadataValue},
};
use uuid::Uuid;

pub const DEFAULT_ACCESS_TOKEN_TTL_SECONDS: u64 = 60 * 60;
pub const DEFAULT_REFRESH_TOKEN_TTL_SECONDS: u64 = 7 * 24 * 60 * 60;
pub const REFRESH_COOKIE_NAME: &str = "tearleads_refresh_token";
pub const REFRESH_COOKIE_PATH: &str = "/connect/tearleads.v2.AuthService";
pub const MIN_PASSWORD_LENGTH: usize = 12;
pub const PASSWORD_COMPLEXITY_ERROR: &str = "Password must include at least one uppercase letter, one lowercase letter, one number, and one symbol";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AccessTokenClaims {
    pub sub: String,
    pub email: String,
    pub jti: String,
    pub exp: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RefreshTokenClaims {
    pub sub: String,
    pub jti: String,
    pub sid: String,
    #[serde(rename = "type")]
    pub token_type: String,
    pub exp: usize,
}

pub fn map_data_access_error(error: DataAccessError) -> Status {
    match error.kind() {
        DataAccessErrorKind::NotFound => Status::not_found(error.message()),
        DataAccessErrorKind::PermissionDenied => Status::permission_denied(error.message()),
        DataAccessErrorKind::InvalidInput => Status::invalid_argument(error.message()),
        DataAccessErrorKind::Unavailable => Status::unavailable("upstream store unavailable"),
        DataAccessErrorKind::Internal => Status::internal("internal data access error"),
    }
}

pub fn parse_positive_ttl_env(key: &str, default_value: u64) -> u64 {
    env::var(key)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default_value)
}

pub fn parse_allowed_email_domains() -> Vec<String> {
    env::var("SMTP_RECIPIENT_DOMAINS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .map(|domain| domain.to_ascii_lowercase())
        .filter(|domain| !domain.is_empty())
        .collect()
}

pub fn refresh_cookie_secure_from_env() -> bool {
    match env::var("AUTH_REFRESH_COOKIE_SECURE")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "true" => true,
        "false" => false,
        _ => env::var("NODE_ENV")
            .ok()
            .map(|value| value == "production")
            .unwrap_or(false),
    }
}

pub fn normalize_email(value: &str) -> Result<String, Status> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err(Status::invalid_argument("email and password are required"));
    }
    if !email_regex().is_match(&normalized) {
        return Err(Status::invalid_argument("Invalid email format"));
    }
    Ok(normalized)
}

pub fn normalize_password(value: &str) -> Result<String, Status> {
    let normalized = value.trim().to_string();
    if normalized.is_empty() {
        return Err(Status::invalid_argument("email and password are required"));
    }
    Ok(normalized)
}

pub fn validate_registration_password(password: &str) -> Result<(), Status> {
    if password.len() < MIN_PASSWORD_LENGTH {
        return Err(Status::invalid_argument(format!(
            "Password must be at least {MIN_PASSWORD_LENGTH} characters"
        )));
    }
    if !password_meets_complexity(password) {
        return Err(Status::invalid_argument(PASSWORD_COMPLEXITY_ERROR));
    }
    Ok(())
}

pub fn validate_allowed_email_domain(
    email: &str,
    allowed_domains: &[String],
) -> Result<(), Status> {
    if allowed_domains.is_empty() {
        return Ok(());
    }
    let Some(domain) = email.split('@').nth(1) else {
        return Err(Status::invalid_argument("Invalid email format"));
    };
    if !allowed_domains.iter().any(|allowed| allowed == domain) {
        return Err(Status::invalid_argument(format!(
            "Email domain not allowed. Allowed domains: {}",
            allowed_domains.join(", ")
        )));
    }
    Ok(())
}

pub fn normalize_vfs_key_setup(setup: AuthVfsKeySetup) -> Result<AuthVfsKeySetupInput, Status> {
    let public_encryption_key = setup.public_encryption_key.trim().to_string();
    let encrypted_private_keys = setup.encrypted_private_keys.trim().to_string();
    let argon2_salt = setup.argon2_salt.trim().to_string();
    if public_encryption_key.is_empty()
        || encrypted_private_keys.is_empty()
        || argon2_salt.is_empty()
    {
        return Err(Status::invalid_argument(
            "vfsKeySetup must include publicEncryptionKey, encryptedPrivateKeys, and argon2Salt",
        ));
    }

    let public_signing_key = setup
        .public_signing_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    Ok(AuthVfsKeySetupInput {
        public_encryption_key,
        public_signing_key,
        encrypted_private_keys,
        argon2_salt,
    })
}

pub fn hash_password(password: &str) -> Result<(String, String), Status> {
    let salt = base64::engine::general_purpose::STANDARD.encode(Uuid::new_v4().as_bytes());
    let mut output = [0_u8; 64];
    let params = ScryptParams::new(14, 8, 1, output.len())
        .map_err(|_| Status::internal("Failed to hash password"))?;
    scrypt(password.as_bytes(), salt.as_bytes(), &params, &mut output)
        .map_err(|_| Status::internal("Failed to hash password"))?;
    Ok((
        salt,
        base64::engine::general_purpose::STANDARD.encode(output),
    ))
}

pub fn verify_password(password: &str, salt: &str, hash: &str) -> Result<bool, Status> {
    let expected = base64::engine::general_purpose::STANDARD
        .decode(hash)
        .map_err(|_| Status::internal("Failed to authenticate"))?;
    let mut derived = vec![0_u8; expected.len()];
    let params = ScryptParams::new(14, 8, 1, expected.len())
        .map_err(|_| Status::internal("Failed to authenticate"))?;
    scrypt(password.as_bytes(), salt.as_bytes(), &params, &mut derived)
        .map_err(|_| Status::internal("Failed to authenticate"))?;
    Ok(timing_safe_equal(&expected, &derived))
}

pub fn client_ip_from_metadata(metadata: &MetadataMap) -> String {
    if let Some(forwarded_for) = metadata
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
    {
        let first = forwarded_for.split(',').next().map(str::trim).unwrap_or("");
        if !first.is_empty() {
            return first.to_string();
        }
    }
    if let Some(real_ip) = metadata
        .get("x-real-ip")
        .and_then(|value| value.to_str().ok())
    {
        let normalized = real_ip.trim();
        if !normalized.is_empty() {
            return normalized.to_string();
        }
    }
    String::from("127.0.0.1")
}

pub fn normalize_optional_non_empty(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

pub fn refresh_token_from_cookie(metadata: &MetadataMap) -> Option<String> {
    let cookie_header = metadata.get("cookie")?.to_str().ok()?;
    for part in cookie_header.split(';') {
        let mut pieces = part.trim().splitn(2, '=');
        let name = pieces.next().map(str::trim).unwrap_or_default();
        if name != REFRESH_COOKIE_NAME {
            continue;
        }
        let value = pieces.next().map(str::trim).unwrap_or_default();
        if value.is_empty() {
            return None;
        }
        return Some(value.to_string());
    }
    None
}

pub fn build_refresh_cookie(refresh_token: &str, ttl_seconds: u64, secure: bool) -> String {
    let mut parts = vec![
        format!("{REFRESH_COOKIE_NAME}={refresh_token}"),
        format!("Max-Age={ttl_seconds}"),
        format!("Path={REFRESH_COOKIE_PATH}"),
        String::from("HttpOnly"),
        String::from("SameSite=Strict"),
    ];
    if secure {
        parts.push(String::from("Secure"));
    }
    parts.join("; ")
}

pub fn build_clear_refresh_cookie(secure: bool) -> String {
    let mut parts = vec![
        format!("{REFRESH_COOKIE_NAME}="),
        String::from("Max-Age=0"),
        String::from("Expires=Thu, 01 Jan 1970 00:00:00 GMT"),
        format!("Path={REFRESH_COOKIE_PATH}"),
        String::from("HttpOnly"),
        String::from("SameSite=Strict"),
    ];
    if secure {
        parts.push(String::from("Secure"));
    }
    parts.join("; ")
}

pub fn append_set_cookie(metadata: &mut MetadataMap, cookie_value: String) -> Result<(), Status> {
    let metadata_value = MetadataValue::try_from(cookie_value)
        .map_err(|_| Status::internal("invalid set-cookie"))?;
    metadata.append("set-cookie", metadata_value);
    Ok(())
}

pub fn expiry_epoch_seconds(ttl_seconds: u64) -> usize {
    let now = std::time::SystemTime::now();
    let expires_at = now
        .checked_add(Duration::from_secs(ttl_seconds))
        .unwrap_or(now)
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    expires_at as usize
}

pub fn saturating_i32(value: u64) -> i32 {
    value.min(i32::MAX as u64) as i32
}

pub fn map_auth_session_summary(
    session: AuthSession,
    current_session_id: &str,
) -> Result<AuthSessionSummary, Status> {
    let created_at = parse_required_timestamp("created_at", &session.created_at)?;
    Ok(AuthSessionSummary {
        id: session.id.clone(),
        created_at: Some(created_at),
        expires_at: None,
        last_active_at: parse_optional_timestamp(&session.last_active_at),
        is_current: session.id == current_session_id,
        is_admin: session.admin,
        ip_address: session.ip_address,
    })
}

pub fn parse_optional_timestamp(value: &str) -> Option<Timestamp> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|parsed| parsed.with_timezone(&Utc))
        .map(|utc| Timestamp {
            seconds: utc.timestamp(),
            nanos: utc.timestamp_subsec_nanos() as i32,
        })
}

pub fn parse_required_timestamp(field: &'static str, value: &str) -> Result<Timestamp, Status> {
    let parsed = DateTime::parse_from_rfc3339(value).map_err(|_| {
        Status::new(
            Code::Internal,
            format!("invalid {field} timestamp in auth session payload"),
        )
    })?;
    let utc = parsed.with_timezone(&Utc);
    Ok(Timestamp {
        seconds: utc.timestamp(),
        nanos: utc.timestamp_subsec_nanos() as i32,
    })
}

fn email_regex() -> &'static Regex {
    static EMAIL_REGEX: OnceLock<Regex> = OnceLock::new();
    EMAIL_REGEX.get_or_init(|| {
        match Regex::new(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$") {
            Ok(pattern) => pattern,
            Err(error) => panic!("invalid email regex pattern: {error}"),
        }
    })
}

fn password_meets_complexity(password: &str) -> bool {
    password.chars().any(char::is_lowercase)
        && password.chars().any(char::is_uppercase)
        && password.chars().any(|character| character.is_ascii_digit())
        && password
            .chars()
            .any(|character| !character.is_alphanumeric() && !character.is_whitespace())
}

fn timing_safe_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right.iter())
        .fold(0_u8, |acc, (lhs, rhs)| acc | (lhs ^ rhs))
        == 0
}

pub fn parse_bearer_token(metadata: &MetadataMap) -> Result<String, Status> {
    let authorization = metadata
        .get("authorization")
        .ok_or_else(|| Status::unauthenticated("Unauthorized"))?
        .to_str()
        .map_err(|_| Status::unauthenticated("Unauthorized"))?;

    authorization
        .trim()
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| Status::unauthenticated("Unauthorized"))
}

pub fn create_access_token(
    secret: &str,
    user_id: &str,
    email: &str,
    session_id: &str,
    ttl_seconds: u64,
) -> Result<String, Status> {
    let claims = AccessTokenClaims {
        sub: user_id.to_string(),
        email: email.to_string(),
        jti: session_id.to_string(),
        exp: expiry_epoch_seconds(ttl_seconds),
    };
    encode_claims(secret, &claims)
}

pub fn create_refresh_token(
    secret: &str,
    user_id: &str,
    refresh_token_id: &str,
    session_id: &str,
    ttl_seconds: u64,
) -> Result<String, Status> {
    let claims = RefreshTokenClaims {
        sub: user_id.to_string(),
        jti: refresh_token_id.to_string(),
        sid: session_id.to_string(),
        token_type: String::from("refresh"),
        exp: expiry_epoch_seconds(ttl_seconds),
    };
    encode_claims(secret, &claims)
}

pub fn decode_access_token(secret: &str, token: &str) -> Result<AccessTokenClaims, Status> {
    jsonwebtoken::decode::<AccessTokenClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map(|decoded| decoded.claims)
    .map_err(|_| Status::unauthenticated("Unauthorized"))
}

pub fn decode_refresh_token(secret: &str, token: &str) -> Result<RefreshTokenClaims, Status> {
    let decoded = jsonwebtoken::decode::<RefreshTokenClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| Status::unauthenticated("Invalid refresh token"))?;
    if decoded.claims.token_type != "refresh" {
        return Err(Status::unauthenticated("Invalid refresh token"));
    }
    Ok(decoded.claims)
}

fn encode_claims<T: Serialize>(secret: &str, claims: &T) -> Result<String, Status> {
    jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|_| Status::internal("Failed to mint auth token"))
}

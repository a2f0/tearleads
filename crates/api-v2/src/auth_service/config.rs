use std::env;

use super::support::{
    DEFAULT_ACCESS_TOKEN_TTL_SECONDS, DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
    parse_allowed_email_domains, parse_positive_ttl_env, refresh_cookie_secure_from_env,
};

/// Runtime config for auth token, cookie, and domain policy behavior.
#[derive(Debug, Clone)]
pub struct AuthServiceConfig {
    pub(super) jwt_secret: Option<String>,
    pub(super) access_token_ttl_seconds: u64,
    pub(super) refresh_token_ttl_seconds: u64,
    pub(super) allowed_email_domains: Vec<String>,
    pub(super) refresh_cookie_secure: bool,
}

impl AuthServiceConfig {
    /// Creates an explicit auth configuration.
    pub fn with_values(
        jwt_secret: Option<String>,
        access_token_ttl_seconds: u64,
        refresh_token_ttl_seconds: u64,
        allowed_email_domains: Vec<String>,
        refresh_cookie_secure: bool,
    ) -> Self {
        Self {
            jwt_secret,
            access_token_ttl_seconds,
            refresh_token_ttl_seconds,
            allowed_email_domains,
            refresh_cookie_secure,
        }
    }

    /// Reads auth configuration from process environment variables.
    pub fn from_env() -> Self {
        Self::with_values(
            env::var("JWT_SECRET")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            parse_positive_ttl_env("ACCESS_TOKEN_TTL_SECONDS", DEFAULT_ACCESS_TOKEN_TTL_SECONDS),
            parse_positive_ttl_env(
                "REFRESH_TOKEN_TTL_SECONDS",
                DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
            ),
            parse_allowed_email_domains(),
            refresh_cookie_secure_from_env(),
        )
    }
}

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
            normalize_env_value(env::var("JWT_SECRET")),
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

fn normalize_env_value(value: Result<String, env::VarError>) -> Option<String> {
    value
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::{AuthServiceConfig, normalize_env_value};

    #[test]
    fn normalize_env_value_trims_and_filters_empty_values() {
        assert_eq!(
            normalize_env_value(Ok("  secret  ".to_string())),
            Some("secret".to_string())
        );
        assert_eq!(normalize_env_value(Ok("   ".to_string())), None);
        assert_eq!(
            normalize_env_value(Err(std::env::VarError::NotPresent)),
            None
        );
    }

    #[test]
    fn from_env_and_with_values_are_constructible() {
        let _ = AuthServiceConfig::from_env();

        let explicit = AuthServiceConfig::with_values(
            Some("secret".to_string()),
            10,
            20,
            vec!["example.com".to_string()],
            true,
        );
        assert!(explicit.jwt_secret.is_some());
    }
}

//! Auth policy boundaries for billing RPC handlers.

use std::env;

use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use redis::AsyncCommands;
use serde::Deserialize;
use tonic::{Status, metadata::MetadataMap};

/// Authenticated billing access context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BillingAccessContext {
    user_id: String,
}

impl BillingAccessContext {
    /// Constructs an access context for one authenticated user.
    pub fn new(user_id: impl Into<String>) -> Self {
        Self {
            user_id: user_id.into(),
        }
    }

    /// Returns authenticated user id.
    pub fn user_id(&self) -> &str {
        &self.user_id
    }
}

/// Error categories returned by billing auth policy checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BillingAuthErrorKind {
    /// Caller is not authenticated.
    Unauthenticated,
    /// Auth policy could not be evaluated due to internal errors.
    Internal,
}

/// Typed auth policy error for mapping into transport status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BillingAuthError {
    kind: BillingAuthErrorKind,
    message: String,
}

impl BillingAuthError {
    /// Constructs a billing auth error from kind and message.
    pub fn new(kind: BillingAuthErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    fn kind(&self) -> BillingAuthErrorKind {
        self.kind
    }

    fn message(&self) -> &str {
        &self.message
    }
}

/// Authorization boundary for billing handler operations.
pub trait BillingRequestAuthorizer: Send + Sync {
    /// Verifies that request metadata grants access and resolves user context.
    fn authorize_billing_request(
        &self,
        metadata: &MetadataMap,
    ) -> tearleads_data_access_traits::BoxFuture<'_, Result<BillingAccessContext, BillingAuthError>>;
}

#[derive(Debug, Clone, Deserialize)]
struct JwtClaims {
    sub: String,
    jti: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredBillingSession {
    user_id: String,
}

/// Runtime billing authorizer that verifies JWT + session coherence.
#[derive(Debug, Clone)]
pub struct JwtSessionBillingAuthorizer {
    jwt_secret: Option<String>,
    redis_client: Option<redis::Client>,
    config_error: Option<String>,
}

impl JwtSessionBillingAuthorizer {
    fn with_runtime_config(jwt_secret: Option<String>, redis_url: Option<String>) -> Self {
        let (redis_client, config_error) = match redis_url {
            Some(url) => match redis::Client::open(url) {
                Ok(client) => (Some(client), None),
                Err(error) => (
                    None,
                    Some(format!(
                        "failed to create redis client for billing auth: {error}"
                    )),
                ),
            },
            None => (None, None),
        };

        Self {
            jwt_secret,
            redis_client,
            config_error,
        }
    }

    /// Creates runtime authorizer using `JWT_SECRET` and `REDIS_URL`.
    pub fn from_env() -> Self {
        let jwt_secret = normalize_env_value(env::var("JWT_SECRET"));
        let redis_url = normalize_env_value(env::var("REDIS_URL"));
        Self::with_runtime_config(jwt_secret, redis_url)
    }

    fn parse_bearer_token(metadata: &MetadataMap) -> Result<String, BillingAuthError> {
        let authorization = metadata.get("authorization").ok_or_else(|| {
            BillingAuthError::new(
                BillingAuthErrorKind::Unauthenticated,
                "missing authorization",
            )
        })?;
        let authorization = authorization.to_str().unwrap_or_default();
        if authorization.is_empty() {
            return Err(BillingAuthError::new(
                BillingAuthErrorKind::Unauthenticated,
                "invalid authorization header",
            ));
        }

        let token = authorization
            .trim()
            .strip_prefix("Bearer ")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                BillingAuthError::new(
                    BillingAuthErrorKind::Unauthenticated,
                    "authorization must use Bearer token",
                )
            })?;

        Ok(token.to_string())
    }

    fn decode_claims(&self, token: &str) -> Result<JwtClaims, BillingAuthError> {
        let Some(secret) = self.jwt_secret.as_ref() else {
            return Err(BillingAuthError::new(
                BillingAuthErrorKind::Internal,
                "JWT_SECRET is not configured",
            ));
        };

        let validation = Validation::new(Algorithm::HS256);
        let decoded = jsonwebtoken::decode::<JwtClaims>(
            token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &validation,
        )
        .map_err(|_| {
            BillingAuthError::new(BillingAuthErrorKind::Unauthenticated, "Unauthorized")
        })?;

        Ok(decoded.claims)
    }

    async fn validate_session(
        &self,
        session_id: &str,
        expected_user_id: &str,
    ) -> Result<(), BillingAuthError> {
        if let Some(config_error) = self.config_error.as_ref() {
            return Err(BillingAuthError::new(
                BillingAuthErrorKind::Internal,
                config_error.clone(),
            ));
        }

        let Some(client) = self.redis_client.as_ref() else {
            return Err(BillingAuthError::new(
                BillingAuthErrorKind::Internal,
                "REDIS_URL is not configured",
            ));
        };

        let mut connection = client
            .get_multiplexed_async_connection()
            .await
            .map_err(|error| {
                BillingAuthError::new(
                    BillingAuthErrorKind::Internal,
                    format!("failed to connect redis for billing auth: {error}"),
                )
            })?;

        let key = format!("session:{session_id}");
        let raw_session: Option<String> = connection.get(key).await.map_err(|error| {
            BillingAuthError::new(
                BillingAuthErrorKind::Internal,
                format!("failed to load session for billing auth: {error}"),
            )
        })?;

        let Some(raw_session) = raw_session else {
            return Err(BillingAuthError::new(
                BillingAuthErrorKind::Unauthenticated,
                "Unauthorized",
            ));
        };

        let parsed: StoredBillingSession = serde_json::from_str(&raw_session).map_err(|_| {
            BillingAuthError::new(BillingAuthErrorKind::Unauthenticated, "Unauthorized")
        })?;

        if parsed.user_id != expected_user_id {
            return Err(BillingAuthError::new(
                BillingAuthErrorKind::Unauthenticated,
                "Unauthorized",
            ));
        }

        Ok(())
    }
}

fn normalize_env_value(value: Result<String, env::VarError>) -> Option<String> {
    value
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

impl BillingRequestAuthorizer for JwtSessionBillingAuthorizer {
    fn authorize_billing_request(
        &self,
        metadata: &MetadataMap,
    ) -> tearleads_data_access_traits::BoxFuture<'_, Result<BillingAccessContext, BillingAuthError>>
    {
        let token = Self::parse_bearer_token(metadata);
        Box::pin(async move {
            let token = token?;
            let claims = self.decode_claims(&token)?;
            self.validate_session(&claims.jti, &claims.sub).await?;
            Ok(BillingAccessContext::new(claims.sub))
        })
    }
}

/// Static harness policy: validates Bearer/JWT-like shape and returns fixture user.
#[derive(Debug, Clone, Copy)]
pub struct AuthorizationHeaderBillingAuthorizer;

impl BillingRequestAuthorizer for AuthorizationHeaderBillingAuthorizer {
    fn authorize_billing_request(
        &self,
        metadata: &MetadataMap,
    ) -> tearleads_data_access_traits::BoxFuture<'_, Result<BillingAccessContext, BillingAuthError>>
    {
        let token_result = parse_harness_bearer_token(metadata);
        Box::pin(async move {
            let token = token_result?;
            if token.split('.').count() != 3 {
                return Err(BillingAuthError::new(
                    BillingAuthErrorKind::Unauthenticated,
                    "bearer token must be jwt-like",
                ));
            }

            Ok(BillingAccessContext::new("user-1"))
        })
    }
}

fn parse_harness_bearer_token(metadata: &MetadataMap) -> Result<String, BillingAuthError> {
    let authorization = metadata.get("authorization").ok_or_else(|| {
        BillingAuthError::new(
            BillingAuthErrorKind::Unauthenticated,
            "missing authorization",
        )
    })?;
    let authorization = authorization.to_str().unwrap_or_default();
    if authorization.is_empty() {
        return Err(BillingAuthError::new(
            BillingAuthErrorKind::Unauthenticated,
            "invalid authorization header",
        ));
    }

    authorization
        .trim()
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            BillingAuthError::new(
                BillingAuthErrorKind::Unauthenticated,
                "authorization must use Bearer token",
            )
        })
}

/// Maps typed auth errors into gRPC status for billing handlers.
pub fn map_billing_auth_error(error: BillingAuthError) -> Status {
    match error.kind() {
        BillingAuthErrorKind::Unauthenticated => Status::unauthenticated(error.message()),
        BillingAuthErrorKind::Internal => Status::internal("billing authorization failed"),
    }
}

#[cfg(test)]
mod tests;

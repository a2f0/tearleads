use std::env;

use chrono::Utc;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use tearleads_data_access_traits::{
    AuthCreateSessionInput, AuthRefreshToken, AuthRotateTokensInput, AuthSession, BoxFuture,
    DataAccessError, DataAccessErrorKind, RedisAuthSessionRepository,
};

const REDIS_URL_ENV_KEY: &str = "REDIS_URL";
const SESSION_PREFIX: &str = "session:";
const USER_SESSIONS_PREFIX: &str = "user_sessions:";
const REFRESH_TOKEN_PREFIX: &str = "refresh_token:";

/// Redis-backed auth session and refresh-token repository.
#[derive(Debug, Clone)]
pub struct RedisAuthSessionStore {
    redis_client: Option<redis::Client>,
    config_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSession {
    user_id: String,
    email: String,
    admin: bool,
    created_at: String,
    last_active_at: String,
    ip_address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRefreshToken {
    session_id: String,
    user_id: String,
    created_at: String,
}

impl RedisAuthSessionStore {
    fn with_runtime_config(redis_url: Option<String>) -> Self {
        let (redis_client, config_error) = match redis_url {
            Some(url) => match redis::Client::open(url) {
                Ok(client) => (Some(client), None),
                Err(error) => (
                    None,
                    Some(format!("failed to create auth redis client: {error}")),
                ),
            },
            None => (None, None),
        };

        Self {
            redis_client,
            config_error,
        }
    }

    /// Builds a Redis session store from `REDIS_URL`.
    pub fn from_env() -> Self {
        let redis_url = normalize_env_value(env::var(REDIS_URL_ENV_KEY));
        Self::with_runtime_config(redis_url)
    }

    fn session_key(session_id: &str) -> String {
        format!("{SESSION_PREFIX}{session_id}")
    }

    fn user_sessions_key(user_id: &str) -> String {
        format!("{USER_SESSIONS_PREFIX}{user_id}")
    }

    fn refresh_token_key(token_id: &str) -> String {
        format!("{REFRESH_TOKEN_PREFIX}{token_id}")
    }

    async fn connection(
        &self,
    ) -> Result<redis::aio::MultiplexedConnection, tearleads_data_access_traits::DataAccessError>
    {
        if let Some(config_error) = self.config_error.as_ref() {
            return Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                config_error.clone(),
            ));
        }

        let Some(client) = self.redis_client.as_ref() else {
            return Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "REDIS_URL is not configured",
            ));
        };

        client
            .get_multiplexed_async_connection()
            .await
            .map_err(|error| {
                DataAccessError::new(
                    DataAccessErrorKind::Unavailable,
                    format!("redis connection failed: {error}"),
                )
            })
    }

    fn map_redis_error(action: &'static str, error: redis::RedisError) -> DataAccessError {
        DataAccessError::new(
            DataAccessErrorKind::Unavailable,
            format!("redis {action} failed: {error}"),
        )
    }

    fn map_action<T>(
        action: &'static str,
        result: Result<T, redis::RedisError>,
    ) -> Result<T, DataAccessError> {
        result.map_err(|error| Self::map_redis_error(action, error))
    }
}

fn normalize_env_value(value: Result<String, env::VarError>) -> Option<String> {
    value
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

impl RedisAuthSessionRepository for RedisAuthSessionStore {
    fn create_session(
        &self,
        session_id: &str,
        input: AuthCreateSessionInput,
        ttl_seconds: u64,
    ) -> BoxFuture<'_, Result<(), DataAccessError>> {
        let session_id = session_id.to_string();
        Box::pin(async move {
            let mut connection = self.connection().await?;
            let now = Utc::now().to_rfc3339();
            let session_key = Self::session_key(&session_id);
            let user_sessions_key = Self::user_sessions_key(&input.user_id);

            let payload = serde_json::json!({
                "userId": input.user_id.clone(),
                "email": input.email,
                "admin": input.admin,
                "createdAt": now.clone(),
                "lastActiveAt": now,
                "ipAddress": input.ip_address,
            })
            .to_string();

            let _: () = Self::map_action::<()>(
                "set_ex session",
                connection.set_ex(session_key, payload, ttl_seconds).await,
            )?;
            let _: usize = Self::map_action::<usize>(
                "sadd user_sessions",
                connection
                    .sadd(user_sessions_key.clone(), &session_id)
                    .await,
            )?;
            let _: bool = Self::map_action::<bool>(
                "expire user_sessions",
                connection
                    .expire(user_sessions_key, ttl_seconds as i64)
                    .await,
            )?;

            Ok(())
        })
    }

    fn get_session(
        &self,
        session_id: &str,
    ) -> BoxFuture<'_, Result<Option<AuthSession>, DataAccessError>> {
        let session_id = session_id.to_string();
        Box::pin(async move {
            let mut connection = self.connection().await?;
            let raw: Option<String> = match Self::map_action(
                "get session",
                connection.get(Self::session_key(&session_id)).await,
            ) {
                Ok(raw) => raw,
                Err(error) => return Err(error),
            };
            let Some(raw) = raw else {
                return Ok(None);
            };

            let parsed: StoredSession = serde_json::from_str(&raw).map_err(|error| {
                DataAccessError::new(
                    DataAccessErrorKind::Internal,
                    format!("failed to parse auth session JSON: {error}"),
                )
            })?;
            Ok(Some(AuthSession {
                id: session_id,
                user_id: parsed.user_id,
                email: parsed.email,
                admin: parsed.admin,
                created_at: parsed.created_at,
                last_active_at: parsed.last_active_at,
                ip_address: parsed.ip_address,
            }))
        })
    }

    fn get_sessions_by_user_id(
        &self,
        user_id: &str,
    ) -> BoxFuture<'_, Result<Vec<AuthSession>, DataAccessError>> {
        let user_id = user_id.to_string();
        Box::pin(async move {
            let mut connection = self.connection().await?;
            let user_sessions_key = Self::user_sessions_key(&user_id);
            let session_ids: Vec<String> = Self::map_action(
                "smembers user_sessions",
                connection.smembers(&user_sessions_key).await,
            )?;
            let mut sessions = Vec::new();

            for session_id in session_ids {
                let Some(session) = self.get_session(&session_id).await? else {
                    let _: usize = Self::map_action::<usize>(
                        "srem stale session",
                        connection.srem(&user_sessions_key, &session_id).await,
                    )?;
                    continue;
                };
                if session.user_id != user_id {
                    let _: usize = Self::map_action::<usize>(
                        "srem foreign session",
                        connection.srem(&user_sessions_key, &session_id).await,
                    )?;
                    continue;
                }
                sessions.push(session);
            }

            Ok(sessions)
        })
    }

    fn delete_session(
        &self,
        session_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let session_id = session_id.to_string();
        let user_id = user_id.to_string();
        Box::pin(async move {
            let mut connection = self.connection().await?;
            let Some(session) = self.get_session(&session_id).await? else {
                return Ok(false);
            };
            if session.user_id != user_id {
                return Ok(false);
            }

            let _: usize = Self::map_action::<usize>(
                "del session",
                connection.del(Self::session_key(&session_id)).await,
            )?;
            let _: usize = Self::map_action::<usize>(
                "srem user_sessions",
                connection
                    .srem(Self::user_sessions_key(&user_id), &session_id)
                    .await,
            )?;
            Ok(true)
        })
    }

    fn store_refresh_token(
        &self,
        token_id: &str,
        session_id: &str,
        user_id: &str,
        ttl_seconds: u64,
    ) -> BoxFuture<'_, Result<(), DataAccessError>> {
        let token_id = token_id.to_string();
        let session_id = session_id.to_string();
        let user_id = user_id.to_string();
        Box::pin(async move {
            let mut connection = self.connection().await?;
            let payload = serde_json::json!({
                "sessionId": session_id,
                "userId": user_id,
                "createdAt": Utc::now().to_rfc3339(),
            })
            .to_string();
            let _: () = Self::map_action::<()>(
                "set_ex refresh_token",
                connection
                    .set_ex(Self::refresh_token_key(&token_id), payload, ttl_seconds)
                    .await,
            )?;
            Ok(())
        })
    }

    fn get_refresh_token(
        &self,
        token_id: &str,
    ) -> BoxFuture<'_, Result<Option<AuthRefreshToken>, DataAccessError>> {
        let token_id = token_id.to_string();
        Box::pin(async move {
            let mut connection = self.connection().await?;
            let raw: Option<String> = match Self::map_action(
                "get refresh_token",
                connection.get(Self::refresh_token_key(&token_id)).await,
            ) {
                Ok(raw) => raw,
                Err(error) => return Err(error),
            };
            let Some(raw) = raw else {
                return Ok(None);
            };

            let parsed: StoredRefreshToken = serde_json::from_str(&raw).map_err(|error| {
                DataAccessError::new(
                    DataAccessErrorKind::Internal,
                    format!("failed to parse refresh token JSON: {error}"),
                )
            })?;
            Ok(Some(AuthRefreshToken {
                id: token_id,
                session_id: parsed.session_id,
                user_id: parsed.user_id,
                created_at: parsed.created_at,
            }))
        })
    }

    fn delete_refresh_token(&self, token_id: &str) -> BoxFuture<'_, Result<(), DataAccessError>> {
        let token_id = token_id.to_string();
        Box::pin(async move {
            let mut connection = self.connection().await?;
            let _: usize = Self::map_action::<usize>(
                "del refresh_token",
                connection.del(Self::refresh_token_key(&token_id)).await,
            )?;
            Ok(())
        })
    }

    fn rotate_tokens_atomically(
        &self,
        input: AuthRotateTokensInput,
    ) -> BoxFuture<'_, Result<(), DataAccessError>> {
        Box::pin(async move {
            let mut connection = self.connection().await?;
            let now = Utc::now().to_rfc3339();
            let user_sessions_key = Self::user_sessions_key(&input.session_input.user_id);
            let session_payload = serde_json::json!({
                "userId": input.session_input.user_id.clone(),
                "email": input.session_input.email,
                "admin": input.session_input.admin,
                "createdAt": input.original_created_at.unwrap_or_else(|| now.clone()),
                "lastActiveAt": now.clone(),
                "ipAddress": input.session_input.ip_address,
            })
            .to_string();
            let refresh_payload = serde_json::json!({
                "sessionId": input.new_session_id.clone(),
                "userId": input.session_input.user_id,
                "createdAt": now,
            })
            .to_string();

            let mut pipe = redis::pipe();
            pipe.atomic()
                .del(Self::refresh_token_key(&input.old_refresh_token_id))
                .ignore()
                .del(Self::session_key(&input.old_session_id))
                .ignore()
                .cmd("SREM")
                .arg(&user_sessions_key)
                .arg(&input.old_session_id)
                .ignore()
                .cmd("SET")
                .arg(Self::session_key(&input.new_session_id))
                .arg(session_payload)
                .arg("EX")
                .arg(input.session_ttl_seconds)
                .ignore()
                .cmd("SET")
                .arg(Self::refresh_token_key(&input.new_refresh_token_id))
                .arg(refresh_payload)
                .arg("EX")
                .arg(input.refresh_ttl_seconds)
                .ignore()
                .cmd("SADD")
                .arg(&user_sessions_key)
                .arg(&input.new_session_id)
                .ignore()
                .cmd("EXPIRE")
                .arg(&user_sessions_key)
                .arg(input.refresh_ttl_seconds)
                .ignore();

            let _: () = Self::map_action::<()>(
                "rotate_tokens_atomically",
                pipe.query_async(&mut connection).await,
            )?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests;

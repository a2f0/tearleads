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
    /// Builds a Redis session store from `REDIS_URL`.
    pub fn from_env() -> Self {
        let redis_url = env::var(REDIS_URL_ENV_KEY)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

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

            let payload = serde_json::to_string(&StoredSession {
                user_id: input.user_id.clone(),
                email: input.email,
                admin: input.admin,
                created_at: now.clone(),
                last_active_at: now,
                ip_address: input.ip_address,
            })
            .map_err(|error| {
                DataAccessError::new(
                    DataAccessErrorKind::Internal,
                    format!("failed to serialize auth session: {error}"),
                )
            })?;

            let _: () = connection
                .set_ex(session_key, payload, ttl_seconds)
                .await
                .map_err(|error| Self::map_redis_error("set_ex session", error))?;
            let _: usize = connection
                .sadd(user_sessions_key.clone(), &session_id)
                .await
                .map_err(|error| Self::map_redis_error("sadd user_sessions", error))?;
            let _: bool = connection
                .expire(user_sessions_key, ttl_seconds as i64)
                .await
                .map_err(|error| Self::map_redis_error("expire user_sessions", error))?;

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
            let raw: Option<String> = connection
                .get(Self::session_key(&session_id))
                .await
                .map_err(|error| Self::map_redis_error("get session", error))?;
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
            let session_ids: Vec<String> = connection
                .smembers(&user_sessions_key)
                .await
                .map_err(|error| Self::map_redis_error("smembers user_sessions", error))?;
            let mut sessions = Vec::new();

            for session_id in session_ids {
                let Some(session) = self.get_session(&session_id).await? else {
                    let _: usize = connection
                        .srem(&user_sessions_key, &session_id)
                        .await
                        .map_err(|error| Self::map_redis_error("srem stale session", error))?;
                    continue;
                };
                if session.user_id != user_id {
                    let _: usize = connection
                        .srem(&user_sessions_key, &session_id)
                        .await
                        .map_err(|error| Self::map_redis_error("srem foreign session", error))?;
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

            let _: usize = connection
                .del(Self::session_key(&session_id))
                .await
                .map_err(|error| Self::map_redis_error("del session", error))?;
            let _: usize = connection
                .srem(Self::user_sessions_key(&user_id), &session_id)
                .await
                .map_err(|error| Self::map_redis_error("srem user_sessions", error))?;
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
            let payload = serde_json::to_string(&StoredRefreshToken {
                session_id,
                user_id,
                created_at: Utc::now().to_rfc3339(),
            })
            .map_err(|error| {
                DataAccessError::new(
                    DataAccessErrorKind::Internal,
                    format!("failed to serialize refresh token: {error}"),
                )
            })?;
            let _: () = connection
                .set_ex(Self::refresh_token_key(&token_id), payload, ttl_seconds)
                .await
                .map_err(|error| Self::map_redis_error("set_ex refresh_token", error))?;
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
            let raw: Option<String> = connection
                .get(Self::refresh_token_key(&token_id))
                .await
                .map_err(|error| Self::map_redis_error("get refresh_token", error))?;
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
            let _: usize = connection
                .del(Self::refresh_token_key(&token_id))
                .await
                .map_err(|error| Self::map_redis_error("del refresh_token", error))?;
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
            let session_payload = serde_json::to_string(&StoredSession {
                user_id: input.session_input.user_id.clone(),
                email: input.session_input.email,
                admin: input.session_input.admin,
                created_at: input.original_created_at.unwrap_or_else(|| now.clone()),
                last_active_at: now.clone(),
                ip_address: input.session_input.ip_address,
            })
            .map_err(|error| {
                DataAccessError::new(
                    DataAccessErrorKind::Internal,
                    format!("failed to serialize rotated session: {error}"),
                )
            })?;
            let refresh_payload = serde_json::to_string(&StoredRefreshToken {
                session_id: input.new_session_id.clone(),
                user_id: input.session_input.user_id,
                created_at: now,
            })
            .map_err(|error| {
                DataAccessError::new(
                    DataAccessErrorKind::Internal,
                    format!("failed to serialize rotated refresh token: {error}"),
                )
            })?;

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

            let _: () = pipe
                .query_async(&mut connection)
                .await
                .map_err(|error| Self::map_redis_error("rotate_tokens_atomically", error))?;
            Ok(())
        })
    }
}

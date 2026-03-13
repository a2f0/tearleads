//! Binary entrypoint for the API v2 service.

use std::{collections::BTreeMap, env, io::Error, net::SocketAddr};

use axum::{
    body::{Body, to_bytes},
    extract::State,
    http::{Request, StatusCode, header::HOST},
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use redis::aio::MultiplexedConnection;
use startup::{
    initialize_tracing, is_enabled_env_var, read_port, runtime_dependency_error_message,
};
use tokio::net::TcpListener;
use tracing::instrument;

const DEFAULT_PORT: u16 = 5002;
const ADMIN_HARNESS_ENV_KEY: &str = "API_V2_ENABLE_ADMIN_HARNESS";
const REDIS_URL_ENV_KEY: &str = "REDIS_URL";
const CONNECT_UPSTREAM_URL_ENV_KEY: &str = "API_V2_CONNECT_UPSTREAM_URL";
const DEFAULT_CONNECT_UPSTREAM_URL: &str = "http://api:5001/connect";
const MAX_PROXY_REQUEST_BODY_BYTES: usize = 10 * 1024 * 1024;

#[cfg(test)]
mod main_tests;
mod startup;

#[derive(Clone)]
struct ConnectProxyState {
    http_client: reqwest::Client,
    upstream_connect_base_url: String,
}

#[derive(Clone)]
struct RuntimeRedisGateway {
    client: redis::Client,
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    initialize_tracing();

    let origins = env::var("ALLOWED_ORIGINS").unwrap_or_default();
    let app = build_app(&origins)?;
    let port = read_port();
    let address = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(address).await?;

    tracing::info!("api-v2 listening on http://{address}");

    axum::serve(listener, app).await
}

fn build_app(origins: &str) -> std::io::Result<axum::Router> {
    use tearleads_api_v2::TokioPostgresGateway;
    use tearleads_data_access_postgres::PostgresAdminAdapter;
    use tearleads_data_access_redis::RedisAdminAdapter;

    let app = if is_enabled_env_var(ADMIN_HARNESS_ENV_KEY) {
        tracing::info!("{ADMIN_HARNESS_ENV_KEY} enabled — using static admin harness repositories");
        tearleads_api_v2::app_with_origins(origins)
    } else {
        match (
            TokioPostgresGateway::from_env(),
            RuntimeRedisGateway::from_env(),
        ) {
            (Some(postgres_gateway), Some(redis_gateway)) => {
                tracing::info!(
                    "postgres + redis gateways initialized from environment for admin repository wiring"
                );
                let postgres_repo = PostgresAdminAdapter::new(postgres_gateway.clone());
                let redis_repo = RedisAdminAdapter::new(redis_gateway);
                tearleads_api_v2::app_with_repos(
                    origins,
                    postgres_repo,
                    redis_repo,
                    postgres_gateway,
                )
            }
            (postgres_gateway, redis_gateway) => {
                let message = runtime_dependency_error_message(
                    postgres_gateway.is_some(),
                    redis_gateway.is_some(),
                )
                .unwrap_or_else(|| {
                    "api-v2 runtime dependencies changed during startup validation".to_string()
                });
                tracing::error!("{message}");
                return Err(Error::other(message));
            }
        }
    };

    let upstream_connect_base_url = env::var(CONNECT_UPSTREAM_URL_ENV_KEY)
        .unwrap_or_else(|_| DEFAULT_CONNECT_UPSTREAM_URL.to_string());
    tracing::info!("delegated connect upstream base is {upstream_connect_base_url}");
    let proxy_state = ConnectProxyState {
        http_client: reqwest::Client::new(),
        upstream_connect_base_url,
    };

    Ok(app.layer(middleware::from_fn_with_state(
        proxy_state,
        proxy_non_admin_connect_requests,
    )))
}

fn should_proxy_connect_request(path: &str) -> bool {
    path.starts_with("/connect/") && !is_native_connect_path(path)
}

fn is_native_connect_path(path: &str) -> bool {
    path.starts_with("/connect/tearleads.v2.AdminService/")
        || path.starts_with("/connect/tearleads.v2.BillingService/")
        || path.starts_with("/connect/tearleads.v2.ChatService/")
        || path.starts_with("/connect/tearleads.v2.AiService/")
        || path.starts_with("/connect/tearleads.v2.AuthService/")
        || path.starts_with("/connect/tearleads.v2.MlsService/")
        || path.starts_with("/connect/tearleads.v2.NotificationService/")
        || path.starts_with("/connect/tearleads.v2.RevenuecatService/")
        || path.starts_with("/connect/tearleads.v2.VfsService/")
        || path.starts_with("/connect/tearleads.v2.VfsSharesService/")
}

fn build_upstream_connect_url(base_url: &str, path: &str, query: Option<&str>) -> String {
    let mut url = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches("/connect/")
    );
    if let Some(query_string) = query {
        url.push('?');
        url.push_str(query_string);
    }
    url
}

#[instrument(skip_all, fields(path = %request.uri().path()))]
async fn proxy_non_admin_connect_requests(
    State(state): State<ConnectProxyState>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let path = request.uri().path().to_string();
    if !should_proxy_connect_request(&path) {
        return next.run(request).await;
    }

    let (parts, body) = request.into_parts();
    let upstream_url =
        build_upstream_connect_url(&state.upstream_connect_base_url, &path, parts.uri.query());

    let request_body = match to_bytes(body, MAX_PROXY_REQUEST_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(error) => {
            tracing::warn!("failed to read request body for proxy forwarding: {error}");
            return (
                StatusCode::BAD_REQUEST,
                "invalid connect request payload for upstream forwarding",
            )
                .into_response();
        }
    };

    let mut upstream_request = state.http_client.request(parts.method, upstream_url);
    for (name, value) in &parts.headers {
        if *name == HOST {
            continue;
        }
        upstream_request = upstream_request.header(name, value);
    }

    let upstream_response = match upstream_request.body(request_body).send().await {
        Ok(response) => response,
        Err(error) => {
            tracing::error!("failed to proxy connect request upstream: {error}");
            return (
                StatusCode::BAD_GATEWAY,
                "upstream connect service is unavailable",
            )
                .into_response();
        }
    };

    let status = upstream_response.status();
    let headers = upstream_response.headers().clone();
    let response_body = match upstream_response.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            tracing::error!("failed to read upstream connect response body: {error}");
            return (
                StatusCode::BAD_GATEWAY,
                "upstream connect response body could not be read",
            )
                .into_response();
        }
    };

    let mut response = Response::new(Body::from(response_body));
    *response.status_mut() = status;
    for (name, value) in &headers {
        response.headers_mut().insert(name, value.clone());
    }
    response
}

impl RuntimeRedisGateway {
    fn from_env() -> Option<Self> {
        let redis_url = env::var(REDIS_URL_ENV_KEY).ok()?;
        let client = match redis::Client::open(redis_url.clone()) {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!("failed to create redis client from {REDIS_URL_ENV_KEY}: {error}");
                return None;
            }
        };
        tracing::info!("redis gateway initialized from {REDIS_URL_ENV_KEY}");
        Some(Self { client })
    }

    async fn connect(
        &self,
    ) -> Result<MultiplexedConnection, tearleads_data_access_traits::DataAccessError> {
        self.client
            .get_multiplexed_async_connection()
            .await
            .map_err(|error| map_redis_error("connect", error))
    }

    async fn read_key_metadata(
        connection: &mut MultiplexedConnection,
        key: &str,
    ) -> Result<(String, i64), tearleads_data_access_traits::DataAccessError> {
        let key_type: String = redis::cmd("TYPE")
            .arg(key)
            .query_async(connection)
            .await
            .map_err(|error| map_redis_error("type", error))?;
        let ttl_seconds: i64 = redis::cmd("TTL")
            .arg(key)
            .query_async(connection)
            .await
            .map_err(|error| map_redis_error("ttl", error))?;
        Ok((key_type, ttl_seconds))
    }
}

impl tearleads_data_access_redis::RedisAdminGateway for RuntimeRedisGateway {
    fn scan_keys(
        &self,
        cursor: &str,
        limit: u32,
    ) -> tearleads_data_access_traits::BoxFuture<
        '_,
        Result<
            tearleads_data_access_redis::RedisScanResult,
            tearleads_data_access_traits::DataAccessError,
        >,
    > {
        let cursor_value = cursor.to_string();
        Box::pin(async move {
            let mut connection = self.connect().await?;
            let scan_cursor = cursor_value.parse::<u64>().unwrap_or(0);
            let (next_cursor, keys): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(scan_cursor)
                .arg("COUNT")
                .arg(limit)
                .query_async(&mut connection)
                .await
                .map_err(|error| map_redis_error("scan", error))?;

            let mut metadata_pipeline = redis::pipe();
            for key in &keys {
                metadata_pipeline.cmd("TYPE").arg(key);
                metadata_pipeline.cmd("TTL").arg(key);
            }
            let metadata_values: Vec<redis::Value> = metadata_pipeline
                .query_async(&mut connection)
                .await
                .map_err(|error| map_redis_error("scan metadata", error))?;
            let expected_metadata_len = keys.len() * 2;
            if metadata_values.len() != expected_metadata_len {
                return Err(tearleads_data_access_traits::DataAccessError::new(
                    tearleads_data_access_traits::DataAccessErrorKind::Internal,
                    format!(
                        "redis scan metadata shape mismatch: expected {expected_metadata_len} values, got {}",
                        metadata_values.len()
                    ),
                ));
            }

            let mut records = Vec::with_capacity(keys.len());
            for (index, key) in keys.into_iter().enumerate() {
                let metadata_offset = index * 2;
                let key_type: String =
                    redis::from_redis_value(&metadata_values[metadata_offset])
                        .map_err(|error| map_redis_error("scan metadata decode type", error))?;
                let ttl_seconds: i64 =
                    redis::from_redis_value(&metadata_values[metadata_offset + 1])
                        .map_err(|error| map_redis_error("scan metadata decode ttl", error))?;
                records.push(tearleads_data_access_redis::RedisKeyRecord {
                    key,
                    key_type,
                    ttl_seconds,
                    value: None,
                });
            }

            Ok(tearleads_data_access_redis::RedisScanResult {
                keys: records,
                next_cursor: next_cursor.to_string(),
            })
        })
    }

    fn read_key(
        &self,
        key: &str,
    ) -> tearleads_data_access_traits::BoxFuture<
        '_,
        Result<
            tearleads_data_access_redis::RedisKeyRecord,
            tearleads_data_access_traits::DataAccessError,
        >,
    > {
        let key_name = key.to_string();
        Box::pin(async move {
            let mut connection = self.connect().await?;
            let (key_type, ttl_seconds) =
                Self::read_key_metadata(&mut connection, &key_name).await?;
            if key_type == "none" {
                return Err(tearleads_data_access_traits::DataAccessError::new(
                    tearleads_data_access_traits::DataAccessErrorKind::NotFound,
                    format!("key not found: {key_name}"),
                ));
            }

            let value = read_redis_key_value(&mut connection, &key_name, &key_type).await?;

            Ok(tearleads_data_access_redis::RedisKeyRecord {
                key: key_name,
                key_type,
                ttl_seconds,
                value,
            })
        })
    }

    fn delete_key(
        &self,
        key: &str,
    ) -> tearleads_data_access_traits::BoxFuture<
        '_,
        Result<bool, tearleads_data_access_traits::DataAccessError>,
    > {
        let key_name = key.to_string();
        Box::pin(async move {
            let mut connection = self.connect().await?;
            let removed_count: u64 = redis::cmd("DEL")
                .arg(key_name)
                .query_async(&mut connection)
                .await
                .map_err(|error| map_redis_error("delete", error))?;
            Ok(removed_count > 0)
        })
    }

    fn read_db_size(
        &self,
    ) -> tearleads_data_access_traits::BoxFuture<
        '_,
        Result<u64, tearleads_data_access_traits::DataAccessError>,
    > {
        Box::pin(async move {
            let mut connection = self.connect().await?;
            redis::cmd("DBSIZE")
                .query_async(&mut connection)
                .await
                .map_err(|error| map_redis_error("dbsize", error))
        })
    }
}

async fn read_redis_key_value(
    connection: &mut MultiplexedConnection,
    key: &str,
    key_type: &str,
) -> Result<
    Option<tearleads_data_access_traits::RedisValue>,
    tearleads_data_access_traits::DataAccessError,
> {
    match key_type {
        "string" => {
            let value: Option<String> = redis::cmd("GET")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(|error| map_redis_error("get", error))?;
            Ok(value.map(tearleads_data_access_traits::RedisValue::String))
        }
        "list" => {
            let values: Vec<String> = redis::cmd("LRANGE")
                .arg(key)
                .arg(0)
                .arg(-1)
                .query_async(connection)
                .await
                .map_err(|error| map_redis_error("lrange", error))?;
            Ok(Some(tearleads_data_access_traits::RedisValue::List(values)))
        }
        "set" => {
            let mut values: Vec<String> = redis::cmd("SMEMBERS")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(|error| map_redis_error("smembers", error))?;
            values.sort();
            Ok(Some(tearleads_data_access_traits::RedisValue::List(values)))
        }
        "zset" => {
            let values: Vec<String> = redis::cmd("ZRANGE")
                .arg(key)
                .arg(0)
                .arg(-1)
                .query_async(connection)
                .await
                .map_err(|error| map_redis_error("zrange", error))?;
            Ok(Some(tearleads_data_access_traits::RedisValue::List(values)))
        }
        "hash" => {
            let values: Vec<(String, String)> = redis::cmd("HGETALL")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(|error| map_redis_error("hgetall", error))?;
            let map = values.into_iter().collect::<BTreeMap<_, _>>();
            Ok(Some(tearleads_data_access_traits::RedisValue::Map(map)))
        }
        _ => Ok(None),
    }
}

fn map_redis_error(
    operation: &str,
    error: redis::RedisError,
) -> tearleads_data_access_traits::DataAccessError {
    let kind = if error.is_io_error() {
        tearleads_data_access_traits::DataAccessErrorKind::Unavailable
    } else {
        tearleads_data_access_traits::DataAccessErrorKind::Internal
    };
    tearleads_data_access_traits::DataAccessError::new(
        kind,
        format!("redis {operation} failed: {error}"),
    )
}

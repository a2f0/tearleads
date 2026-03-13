#![allow(clippy::expect_used)]

use std::{
    net::TcpStream,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use jsonwebtoken::{Algorithm, EncodingKey, Header};
use redis::AsyncCommands;
use serde::Serialize;
use tonic::{Code, metadata::MetadataMap};

use super::{
    AuthorizationHeaderBillingAuthorizer, BillingAccessContext, BillingAuthError,
    BillingAuthErrorKind, BillingRequestAuthorizer, JwtSessionBillingAuthorizer,
    map_billing_auth_error, normalize_env_value,
};

#[derive(Serialize)]
struct Claims {
    sub: String,
    jti: String,
    exp: usize,
}

struct RedisServer {
    child: Child,
    url: String,
}

impl RedisServer {
    fn start() -> Self {
        let port = reserve_free_port();
        let server_binary = resolve_redis_server_binary().expect(
            "redis-compatible server binary not found (expected redis-server or valkey-server)",
        );

        let child = Command::new(server_binary)
            .arg("--port")
            .arg(port.to_string())
            .arg("--bind")
            .arg("127.0.0.1")
            .arg("--save")
            .arg("")
            .arg("--appendonly")
            .arg("no")
            .arg("--daemonize")
            .arg("no")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap_or_else(|error| {
                panic!("redis-compatible server should start ({server_binary}): {error}")
            });

        wait_for_port(port);
        Self {
            child,
            url: format!("redis://127.0.0.1:{port}"),
        }
    }
}

impl Drop for RedisServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn resolve_redis_server_binary() -> Option<&'static str> {
    const CANDIDATES: [&str; 3] = [
        "/opt/homebrew/bin/redis-server",
        "redis-server",
        "valkey-server",
    ];

    CANDIDATES.into_iter().find(|candidate| {
        Command::new(candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    })
}

fn reserve_free_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind should succeed");
    listener
        .local_addr()
        .expect("local addr should resolve")
        .port()
}

fn wait_for_port(port: u16) {
    for _ in 0..40 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        thread::sleep(Duration::from_millis(25));
    }
    panic!("redis server on port {port} did not become ready");
}

fn metadata_with_authorization(value: &str) -> MetadataMap {
    let mut metadata = MetadataMap::new();
    metadata.insert(
        "authorization",
        value.parse().expect("metadata value should parse"),
    );
    metadata
}

fn jwt_token(secret: &str, sub: &str, session_id: &str) -> String {
    let exp = SystemTime::now()
        .checked_add(Duration::from_secs(3600))
        .expect("duration should add")
        .duration_since(UNIX_EPOCH)
        .expect("time should be after epoch")
        .as_secs() as usize;
    jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &Claims {
            sub: sub.to_string(),
            jti: session_id.to_string(),
            exp,
        },
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .expect("jwt should encode")
}

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
fn parse_bearer_token_covers_errors_and_success() {
    let missing = JwtSessionBillingAuthorizer::parse_bearer_token(&MetadataMap::new())
        .expect_err("missing authorization should fail");
    assert_eq!(missing.kind, BillingAuthErrorKind::Unauthenticated);

    let mut empty_header = MetadataMap::new();
    empty_header.insert(
        "authorization",
        tonic::metadata::MetadataValue::from_static(""),
    );
    let empty_error = JwtSessionBillingAuthorizer::parse_bearer_token(&empty_header)
        .expect_err("empty authorization header should fail");
    assert_eq!(empty_error.kind, BillingAuthErrorKind::Unauthenticated);

    let prefix_error =
        JwtSessionBillingAuthorizer::parse_bearer_token(&metadata_with_authorization("Basic abc"))
            .expect_err("non-bearer auth should fail");
    assert_eq!(prefix_error.kind, BillingAuthErrorKind::Unauthenticated);

    let token = JwtSessionBillingAuthorizer::parse_bearer_token(&metadata_with_authorization(
        "Bearer header.payload.signature",
    ))
    .expect("bearer token should parse");
    assert_eq!(token, "header.payload.signature");
}

#[test]
fn decode_claims_covers_missing_secret_invalid_and_valid_token() {
    let authorizer_without_secret = JwtSessionBillingAuthorizer {
        jwt_secret: None,
        redis_client: None,
        config_error: None,
    };
    let missing_secret = authorizer_without_secret
        .decode_claims("token")
        .expect_err("missing secret should fail");
    assert_eq!(missing_secret.kind, BillingAuthErrorKind::Internal);

    let authorizer = JwtSessionBillingAuthorizer {
        jwt_secret: Some("secret".to_string()),
        redis_client: None,
        config_error: None,
    };
    let invalid = authorizer
        .decode_claims("not-a-jwt")
        .expect_err("invalid token should fail");
    assert_eq!(invalid.kind, BillingAuthErrorKind::Unauthenticated);

    let token = jwt_token("secret", "user-1", "session-1");
    let claims = authorizer
        .decode_claims(&token)
        .expect("valid jwt should decode");
    assert_eq!(claims.sub, "user-1");
    assert_eq!(claims.jti, "session-1");
}

#[tokio::test]
async fn validate_session_covers_non_redis_paths() {
    let config_error_authorizer = JwtSessionBillingAuthorizer {
        jwt_secret: Some("secret".to_string()),
        redis_client: None,
        config_error: Some("broken config".to_string()),
    };
    let config_error = config_error_authorizer
        .validate_session("session-1", "user-1")
        .await
        .expect_err("config error should fail");
    assert_eq!(config_error.kind, BillingAuthErrorKind::Internal);

    let missing_redis_authorizer = JwtSessionBillingAuthorizer {
        jwt_secret: Some("secret".to_string()),
        redis_client: None,
        config_error: None,
    };
    let missing_redis = missing_redis_authorizer
        .validate_session("session-1", "user-1")
        .await
        .expect_err("missing redis config should fail");
    assert_eq!(missing_redis.kind, BillingAuthErrorKind::Internal);

    let bad_connection_authorizer = JwtSessionBillingAuthorizer::with_runtime_config(
        Some("secret".to_string()),
        Some("redis://127.0.0.1:1".to_string()),
    );
    let bad_connection = bad_connection_authorizer
        .validate_session("session-1", "user-1")
        .await
        .expect_err("connection failure should fail");
    assert_eq!(bad_connection.kind, BillingAuthErrorKind::Internal);
}

#[tokio::test]
async fn validate_session_covers_redis_payload_paths() {
    let redis = RedisServer::start();
    let authorizer = JwtSessionBillingAuthorizer::with_runtime_config(
        Some("secret".to_string()),
        Some(redis.url.clone()),
    );

    let mut connection = redis::Client::open(redis.url.clone())
        .expect("redis client should build")
        .get_multiplexed_async_connection()
        .await
        .expect("redis connection should open");

    let missing = authorizer
        .validate_session("session-missing", "user-1")
        .await
        .expect_err("missing session should fail");
    assert_eq!(missing.kind, BillingAuthErrorKind::Unauthenticated);

    let _: usize = connection
        .sadd("session:session-wrong-type", "member")
        .await
        .expect("sadd should succeed");
    let wrong_type = authorizer
        .validate_session("session-wrong-type", "user-1")
        .await
        .expect_err("wrong type should fail");
    assert_eq!(wrong_type.kind, BillingAuthErrorKind::Internal);

    let _: () = connection
        .set("session:session-invalid-json", "not-json")
        .await
        .expect("set should succeed");
    let invalid_json = authorizer
        .validate_session("session-invalid-json", "user-1")
        .await
        .expect_err("invalid json should fail");
    assert_eq!(invalid_json.kind, BillingAuthErrorKind::Unauthenticated);

    let _: () = connection
        .set("session:session-missing-user", "{}")
        .await
        .expect("set should succeed");
    let missing_user = authorizer
        .validate_session("session-missing-user", "user-1")
        .await
        .expect_err("missing userId should fail");
    assert_eq!(missing_user.kind, BillingAuthErrorKind::Unauthenticated);

    let _: () = connection
        .set("session:session-foreign", "{\"userId\":\"user-2\"}")
        .await
        .expect("set should succeed");
    let mismatch = authorizer
        .validate_session("session-foreign", "user-1")
        .await
        .expect_err("mismatched user should fail");
    assert_eq!(mismatch.kind, BillingAuthErrorKind::Unauthenticated);

    let _: () = connection
        .set("session:session-ok", "{\"userId\":\"user-1\"}")
        .await
        .expect("set should succeed");
    authorizer
        .validate_session("session-ok", "user-1")
        .await
        .expect("matching session should pass");
}

#[tokio::test]
async fn authorize_billing_request_covers_success_and_failure() {
    let _from_env = JwtSessionBillingAuthorizer::from_env();

    let redis = RedisServer::start();
    let secret = "auth-secret";
    let session_id = "session-1";
    let token = jwt_token(secret, "user-1", session_id);

    let mut connection = redis::Client::open(redis.url.clone())
        .expect("redis client should build")
        .get_multiplexed_async_connection()
        .await
        .expect("redis connection should open");
    let _: () = connection
        .set(format!("session:{session_id}"), "{\"userId\":\"user-1\"}")
        .await
        .expect("set should succeed");

    let authorizer = JwtSessionBillingAuthorizer::with_runtime_config(
        Some(secret.to_string()),
        Some(redis.url.clone()),
    );

    let success = authorizer
        .authorize_billing_request(&metadata_with_authorization(&format!("Bearer {token}")))
        .await
        .expect("auth should pass");
    assert_eq!(success.user_id(), "user-1");

    let missing = authorizer
        .authorize_billing_request(&MetadataMap::new())
        .await
        .expect_err("missing auth should fail");
    assert_eq!(missing.kind, BillingAuthErrorKind::Unauthenticated);
}

#[tokio::test]
async fn harness_authorizer_covers_shape_validation() {
    let authorizer = AuthorizationHeaderBillingAuthorizer;

    let missing = authorizer
        .authorize_billing_request(&MetadataMap::new())
        .await
        .expect_err("missing auth should fail");
    assert_eq!(missing.kind, BillingAuthErrorKind::Unauthenticated);

    let malformed = authorizer
        .authorize_billing_request(&metadata_with_authorization("Bearer token"))
        .await
        .expect_err("non-jwt token should fail");
    assert_eq!(malformed.kind, BillingAuthErrorKind::Unauthenticated);

    let mut empty_header = MetadataMap::new();
    empty_header.insert(
        "authorization",
        tonic::metadata::MetadataValue::from_static(""),
    );
    let empty = authorizer
        .authorize_billing_request(&empty_header)
        .await
        .expect_err("empty authorization should fail");
    assert_eq!(empty.kind, BillingAuthErrorKind::Unauthenticated);

    let wrong_prefix = authorizer
        .authorize_billing_request(&metadata_with_authorization("Basic token"))
        .await
        .expect_err("non-bearer token should fail");
    assert_eq!(wrong_prefix.kind, BillingAuthErrorKind::Unauthenticated);

    let success = authorizer
        .authorize_billing_request(&metadata_with_authorization("Bearer a.b.c"))
        .await
        .expect("jwt-like token should pass in harness");
    assert_eq!(success.user_id(), "user-1");
}

#[test]
fn map_billing_auth_error_maps_error_kinds() {
    let unauthenticated = map_billing_auth_error(BillingAuthError::new(
        BillingAuthErrorKind::Unauthenticated,
        "Unauthorized",
    ));
    assert_eq!(unauthenticated.code(), Code::Unauthenticated);
    assert_eq!(unauthenticated.message(), "Unauthorized");

    let internal = map_billing_auth_error(BillingAuthError::new(
        BillingAuthErrorKind::Internal,
        "hidden details",
    ));
    assert_eq!(internal.code(), Code::Internal);
    assert_eq!(internal.message(), "billing authorization failed");
}

#[test]
fn billing_access_context_exposes_user_id() {
    let access = BillingAccessContext::new("user-99");
    assert_eq!(access.user_id(), "user-99");
}

#[test]
fn runtime_config_captures_invalid_redis_url() {
    let authorizer = JwtSessionBillingAuthorizer::with_runtime_config(
        Some("secret".to_string()),
        Some("redis://:invalid-url".to_string()),
    );
    assert!(authorizer.redis_client.is_none());
    assert!(
        authorizer
            .config_error
            .as_deref()
            .unwrap_or_default()
            .contains("failed to create redis client")
    );
}

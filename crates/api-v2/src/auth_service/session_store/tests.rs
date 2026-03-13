#![allow(clippy::expect_used)]

use std::{
    net::TcpStream,
    process::{Child, Command, Stdio},
    thread,
    time::Duration,
};

use redis::AsyncCommands;
use tearleads_data_access_traits::{
    AuthCreateSessionInput, AuthRotateTokensInput, DataAccessErrorKind, RedisAuthSessionRepository,
};

use super::{RedisAuthSessionStore, normalize_env_value};

struct RedisServer {
    child: Child,
    url: String,
}

impl RedisServer {
    fn start() -> Self {
        Self::start_with_disabled_commands(&[])
    }

    fn start_with_disabled_commands(disabled_commands: &[&str]) -> Self {
        let port = reserve_free_port();
        let server_binary = if std::path::Path::new("/opt/homebrew/bin/redis-server").exists() {
            "/opt/homebrew/bin/redis-server"
        } else {
            "redis-server"
        };
        let mut command = Command::new(server_binary);
        command
            .arg("--port")
            .arg(port.to_string())
            .arg("--bind")
            .arg("127.0.0.1")
            .arg("--save")
            .arg("")
            .arg("--appendonly")
            .arg("no")
            .arg("--daemonize")
            .arg("no");
        for redis_command in disabled_commands {
            command.arg("--rename-command").arg(redis_command).arg("");
        }
        let child = command
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("redis-server should start");

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

fn reserve_free_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind should succeed");
    listener
        .local_addr()
        .expect("local addr should resolve")
        .port()
}

fn wait_for_port(port: u16) {
    for _ in 0..200 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    panic!("redis server on port {port} did not become ready");
}

fn session_input(user_id: &str) -> AuthCreateSessionInput {
    AuthCreateSessionInput {
        user_id: user_id.to_string(),
        email: format!("{user_id}@example.com"),
        admin: false,
        ip_address: "127.0.0.1".to_string(),
    }
}

#[test]
fn env_normalization_trims_and_filters_values() {
    assert_eq!(
        normalize_env_value(Ok(" redis://localhost ".to_string())),
        Some("redis://localhost".to_string())
    );
    assert_eq!(normalize_env_value(Ok("   ".to_string())), None);
    assert_eq!(
        normalize_env_value(Err(std::env::VarError::NotPresent)),
        None
    );
}

#[tokio::test]
async fn from_env_and_runtime_config_cover_configuration_paths() {
    let _from_env = RedisAuthSessionStore::from_env();

    let invalid =
        RedisAuthSessionStore::with_runtime_config(Some("redis://:invalid-url".to_string()));
    assert!(invalid.redis_client.is_none());
    assert!(
        invalid
            .config_error
            .as_deref()
            .unwrap_or_default()
            .contains("failed to create auth redis client")
    );

    let missing = RedisAuthSessionStore::with_runtime_config(None);
    let missing_error = missing
        .connection()
        .await
        .expect_err("missing redis url should fail");
    assert_eq!(missing_error.kind(), DataAccessErrorKind::Internal);

    let config_error = invalid
        .connection()
        .await
        .expect_err("invalid redis config should fail");
    assert_eq!(config_error.kind(), DataAccessErrorKind::Internal);

    let unreachable =
        RedisAuthSessionStore::with_runtime_config(Some("redis://127.0.0.1:1".to_string()));
    let unavailable = unreachable
        .connection()
        .await
        .expect_err("unreachable redis should fail");
    assert_eq!(unavailable.kind(), DataAccessErrorKind::Unavailable);
}

#[tokio::test]
async fn key_helpers_and_create_get_delete_session_paths() {
    assert_eq!(RedisAuthSessionStore::session_key("abc"), "session:abc");
    assert_eq!(
        RedisAuthSessionStore::user_sessions_key("u1"),
        "user_sessions:u1"
    );
    assert_eq!(
        RedisAuthSessionStore::refresh_token_key("r1"),
        "refresh_token:r1"
    );

    let redis = RedisServer::start();
    let store = RedisAuthSessionStore::with_runtime_config(Some(redis.url.clone()));

    store
        .create_session("session-1", session_input("user-1"), 120)
        .await
        .expect("create session should succeed");

    let loaded = store
        .get_session("session-1")
        .await
        .expect("get session should succeed")
        .expect("session should exist");
    assert_eq!(loaded.user_id, "user-1");

    let missing = store
        .get_session("missing")
        .await
        .expect("missing lookup should succeed");
    assert!(missing.is_none());

    let wrong_user_delete = store
        .delete_session("session-1", "user-2")
        .await
        .expect("delete should succeed");
    assert!(!wrong_user_delete);

    let deleted = store
        .delete_session("session-1", "user-1")
        .await
        .expect("delete should succeed");
    assert!(deleted);

    let second_delete = store
        .delete_session("session-1", "user-1")
        .await
        .expect("delete missing should succeed");
    assert!(!second_delete);
}

#[tokio::test]
async fn get_session_and_refresh_token_cover_json_parse_failures() {
    let redis = RedisServer::start();
    let store = RedisAuthSessionStore::with_runtime_config(Some(redis.url.clone()));
    let mut connection = redis::Client::open(redis.url.clone())
        .expect("redis client should build")
        .get_multiplexed_async_connection()
        .await
        .expect("redis connection should open");

    let _: () = connection
        .set(RedisAuthSessionStore::session_key("bad-json"), "not-json")
        .await
        .expect("set should succeed");
    let bad_session = store
        .get_session("bad-json")
        .await
        .expect_err("invalid session payload should fail");
    assert_eq!(bad_session.kind(), DataAccessErrorKind::Internal);

    store
        .store_refresh_token("token-1", "session-1", "user-1", 120)
        .await
        .expect("store refresh token should succeed");

    let refresh = store
        .get_refresh_token("token-1")
        .await
        .expect("get refresh token should succeed")
        .expect("refresh token should exist");
    assert_eq!(refresh.session_id, "session-1");

    let _: () = connection
        .set(
            RedisAuthSessionStore::refresh_token_key("bad-refresh"),
            "not-json",
        )
        .await
        .expect("set should succeed");
    let bad_refresh = store
        .get_refresh_token("bad-refresh")
        .await
        .expect_err("invalid refresh payload should fail");
    assert_eq!(bad_refresh.kind(), DataAccessErrorKind::Internal);

    store
        .delete_refresh_token("token-1")
        .await
        .expect("delete refresh token should succeed");
    let missing = store
        .get_refresh_token("token-1")
        .await
        .expect("missing refresh lookup should succeed");
    assert!(missing.is_none());
}

#[tokio::test]
async fn get_sessions_by_user_id_cleans_stale_and_foreign_memberships() {
    let redis = RedisServer::start();
    let store = RedisAuthSessionStore::with_runtime_config(Some(redis.url.clone()));

    store
        .create_session("session-owned", session_input("user-1"), 120)
        .await
        .expect("create owned session should succeed");
    store
        .create_session("session-foreign", session_input("user-2"), 120)
        .await
        .expect("create foreign session should succeed");

    let mut connection = redis::Client::open(redis.url.clone())
        .expect("redis client should build")
        .get_multiplexed_async_connection()
        .await
        .expect("redis connection should open");
    let _: usize = connection
        .sadd(
            RedisAuthSessionStore::user_sessions_key("user-1"),
            "session-missing",
        )
        .await
        .expect("sadd should succeed");
    let _: usize = connection
        .sadd(
            RedisAuthSessionStore::user_sessions_key("user-1"),
            "session-foreign",
        )
        .await
        .expect("sadd should succeed");

    let sessions = store
        .get_sessions_by_user_id("user-1")
        .await
        .expect("get sessions should succeed");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "session-owned");

    let members: Vec<String> = connection
        .smembers(RedisAuthSessionStore::user_sessions_key("user-1"))
        .await
        .expect("smembers should succeed");
    assert_eq!(members, vec!["session-owned".to_string()]);
}

#[tokio::test]
async fn get_sessions_by_user_id_maps_redis_type_errors() {
    let redis = RedisServer::start();
    let store = RedisAuthSessionStore::with_runtime_config(Some(redis.url.clone()));

    let mut connection = redis::Client::open(redis.url.clone())
        .expect("redis client should build")
        .get_multiplexed_async_connection()
        .await
        .expect("redis connection should open");
    let _: () = connection
        .set(
            RedisAuthSessionStore::user_sessions_key("user-1"),
            "not-a-set",
        )
        .await
        .expect("set should succeed");

    let error = store
        .get_sessions_by_user_id("user-1")
        .await
        .expect_err("wrong redis type should fail");
    assert_eq!(error.kind(), DataAccessErrorKind::Unavailable);
    assert!(error.message().contains("smembers user_sessions"));
}

#[tokio::test]
async fn rotate_tokens_atomically_replaces_old_session_and_token() {
    let redis = RedisServer::start();
    let store = RedisAuthSessionStore::with_runtime_config(Some(redis.url.clone()));

    store
        .create_session("session-old", session_input("user-1"), 120)
        .await
        .expect("create old session should succeed");
    store
        .store_refresh_token("refresh-old", "session-old", "user-1", 120)
        .await
        .expect("create old refresh should succeed");

    store
        .rotate_tokens_atomically(AuthRotateTokensInput {
            old_refresh_token_id: "refresh-old".to_string(),
            old_session_id: "session-old".to_string(),
            new_session_id: "session-new".to_string(),
            new_refresh_token_id: "refresh-new".to_string(),
            session_input: AuthCreateSessionInput {
                user_id: "user-1".to_string(),
                email: "user-1@example.com".to_string(),
                admin: true,
                ip_address: "127.0.0.1".to_string(),
            },
            session_ttl_seconds: 300,
            refresh_ttl_seconds: 300,
            original_created_at: Some("2026-03-13T12:00:00Z".to_string()),
        })
        .await
        .expect("rotate tokens should succeed");

    let old_session = store
        .get_session("session-old")
        .await
        .expect("old session lookup should succeed");
    assert!(old_session.is_none());

    let new_session = store
        .get_session("session-new")
        .await
        .expect("new session lookup should succeed")
        .expect("new session should exist");
    assert_eq!(new_session.user_id, "user-1");
    assert!(new_session.admin);
    assert_eq!(new_session.created_at, "2026-03-13T12:00:00Z");

    let old_refresh = store
        .get_refresh_token("refresh-old")
        .await
        .expect("old refresh lookup should succeed");
    assert!(old_refresh.is_none());

    let new_refresh = store
        .get_refresh_token("refresh-new")
        .await
        .expect("new refresh lookup should succeed")
        .expect("new refresh should exist");
    assert_eq!(new_refresh.session_id, "session-new");
}

mod error_paths;

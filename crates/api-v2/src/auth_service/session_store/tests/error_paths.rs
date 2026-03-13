#![allow(clippy::expect_used)]

use redis::AsyncCommands;
use tearleads_data_access_traits::{
    AuthRotateTokensInput, DataAccessErrorKind, RedisAuthSessionRepository,
};

use super::{RedisAuthSessionStore, RedisServer, session_input};

async fn redis_connection(url: &str) -> redis::aio::MultiplexedConnection {
    redis::Client::open(url)
        .expect("redis client should build")
        .get_multiplexed_async_connection()
        .await
        .expect("redis connection should open")
}

#[tokio::test]
async fn create_and_store_refresh_token_map_set_ex_errors() {
    let redis = RedisServer::start_with_disabled_commands(&["SETEX"]);
    let store = RedisAuthSessionStore::with_runtime_config(Some(redis.url.clone()));

    let create_error = store
        .create_session("session-1", session_input("user-1"), 120)
        .await
        .expect_err("set_ex command should fail");
    assert_eq!(create_error.kind(), DataAccessErrorKind::Unavailable);
    assert!(create_error.message().contains("set_ex session"));

    let refresh_error = store
        .store_refresh_token("refresh-1", "session-1", "user-1", 120)
        .await
        .expect_err("refresh set_ex command should fail");
    assert_eq!(refresh_error.kind(), DataAccessErrorKind::Unavailable);
    assert!(refresh_error.message().contains("set_ex refresh_token"));
}

#[tokio::test]
async fn create_session_maps_sadd_errors() {
    let redis = RedisServer::start_with_disabled_commands(&["SADD"]);
    let store = RedisAuthSessionStore::with_runtime_config(Some(redis.url.clone()));

    let error = store
        .create_session("session-1", session_input("user-1"), 120)
        .await
        .expect_err("sadd command should fail");
    assert_eq!(error.kind(), DataAccessErrorKind::Unavailable);
    assert!(error.message().contains("sadd user_sessions"));
}

#[tokio::test]
async fn create_session_maps_expire_errors() {
    let redis = RedisServer::start_with_disabled_commands(&["EXPIRE"]);
    let store = RedisAuthSessionStore::with_runtime_config(Some(redis.url.clone()));

    let error = store
        .create_session("session-1", session_input("user-1"), 120)
        .await
        .expect_err("expire command should fail");
    assert_eq!(error.kind(), DataAccessErrorKind::Unavailable);
    assert!(error.message().contains("expire user_sessions"));
}

#[tokio::test]
async fn get_session_and_refresh_token_map_get_errors() {
    let redis = RedisServer::start_with_disabled_commands(&["GET"]);
    let store = RedisAuthSessionStore::with_runtime_config(Some(redis.url.clone()));

    let session_error = store
        .get_session("session-1")
        .await
        .expect_err("get session should fail");
    assert_eq!(session_error.kind(), DataAccessErrorKind::Unavailable);
    assert!(session_error.message().contains("get session"));

    let refresh_error = store
        .get_refresh_token("refresh-1")
        .await
        .expect_err("get refresh token should fail");
    assert_eq!(refresh_error.kind(), DataAccessErrorKind::Unavailable);
    assert!(refresh_error.message().contains("get refresh_token"));
}

#[tokio::test]
async fn get_sessions_by_user_id_maps_stale_srem_error() {
    let redis = RedisServer::start_with_disabled_commands(&["SREM"]);
    let store = RedisAuthSessionStore::with_runtime_config(Some(redis.url.clone()));
    let mut connection = redis_connection(&redis.url).await;

    let _: usize = connection
        .sadd(
            RedisAuthSessionStore::user_sessions_key("user-1"),
            "session-missing",
        )
        .await
        .expect("seed should succeed");

    let error = store
        .get_sessions_by_user_id("user-1")
        .await
        .expect_err("stale cleanup should fail when srem is disabled");
    assert_eq!(error.kind(), DataAccessErrorKind::Unavailable);
    assert!(error.message().contains("srem stale session"));
}

#[tokio::test]
async fn get_sessions_by_user_id_maps_foreign_srem_error() {
    let redis = RedisServer::start_with_disabled_commands(&["SREM"]);
    let store = RedisAuthSessionStore::with_runtime_config(Some(redis.url.clone()));

    store
        .create_session("session-foreign", session_input("user-2"), 120)
        .await
        .expect("foreign session should be created");

    let mut connection = redis_connection(&redis.url).await;
    let _: usize = connection
        .sadd(
            RedisAuthSessionStore::user_sessions_key("user-1"),
            "session-foreign",
        )
        .await
        .expect("seed should succeed");

    let error = store
        .get_sessions_by_user_id("user-1")
        .await
        .expect_err("foreign cleanup should fail when srem is disabled");
    assert_eq!(error.kind(), DataAccessErrorKind::Unavailable);
    assert!(error.message().contains("srem foreign session"));
}

#[tokio::test]
async fn delete_session_and_refresh_token_map_del_errors() {
    let redis = RedisServer::start_with_disabled_commands(&["DEL"]);
    let store = RedisAuthSessionStore::with_runtime_config(Some(redis.url.clone()));

    store
        .create_session("session-1", session_input("user-1"), 120)
        .await
        .expect("session should be created");
    store
        .store_refresh_token("refresh-1", "session-1", "user-1", 120)
        .await
        .expect("refresh should be created");

    let delete_session_error = store
        .delete_session("session-1", "user-1")
        .await
        .expect_err("del session should fail");
    assert_eq!(
        delete_session_error.kind(),
        DataAccessErrorKind::Unavailable
    );
    assert!(delete_session_error.message().contains("del session"));

    let delete_refresh_error = store
        .delete_refresh_token("refresh-1")
        .await
        .expect_err("del refresh token should fail");
    assert_eq!(
        delete_refresh_error.kind(),
        DataAccessErrorKind::Unavailable
    );
    assert!(delete_refresh_error.message().contains("del refresh_token"));
}

#[tokio::test]
async fn delete_session_maps_srem_errors() {
    let redis = RedisServer::start_with_disabled_commands(&["SREM"]);
    let store = RedisAuthSessionStore::with_runtime_config(Some(redis.url.clone()));

    store
        .create_session("session-1", session_input("user-1"), 120)
        .await
        .expect("session should be created");

    let error = store
        .delete_session("session-1", "user-1")
        .await
        .expect_err("srem user sessions should fail");
    assert_eq!(error.kind(), DataAccessErrorKind::Unavailable);
    assert!(error.message().contains("srem user_sessions"));
}

#[tokio::test]
async fn rotate_tokens_atomically_maps_pipeline_errors() {
    let redis = RedisServer::start_with_disabled_commands(&["MULTI"]);
    let store = RedisAuthSessionStore::with_runtime_config(Some(redis.url.clone()));

    store
        .create_session("session-old", session_input("user-1"), 120)
        .await
        .expect("create old session should succeed");
    store
        .store_refresh_token("refresh-old", "session-old", "user-1", 120)
        .await
        .expect("create old refresh should succeed");

    let error = store
        .rotate_tokens_atomically(AuthRotateTokensInput {
            old_refresh_token_id: "refresh-old".to_string(),
            old_session_id: "session-old".to_string(),
            new_session_id: "session-new".to_string(),
            new_refresh_token_id: "refresh-new".to_string(),
            session_input: session_input("user-1"),
            session_ttl_seconds: 300,
            refresh_ttl_seconds: 300,
            original_created_at: Some("2026-03-13T12:00:00Z".to_string()),
        })
        .await
        .expect_err("pipeline should fail when MULTI is disabled");
    assert_eq!(error.kind(), DataAccessErrorKind::Unavailable);
    assert!(error.message().contains("rotate_tokens_atomically"));
}

#[tokio::test]
async fn rotate_tokens_atomically_sets_created_at_when_original_missing() {
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
            session_input: session_input("user-1"),
            session_ttl_seconds: 300,
            refresh_ttl_seconds: 300,
            original_created_at: None,
        })
        .await
        .expect("rotate should succeed");

    let new_session = store
        .get_session("session-new")
        .await
        .expect("lookup should succeed")
        .expect("new session should exist");
    assert!(!new_session.created_at.is_empty());
}

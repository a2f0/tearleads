//! Integration tests for v2 admin Redis delete handler behavior.

use std::sync::Arc;

mod support;

use support::admin_service::{
    FakeAuthorizer, FakePostgresGateway, FakeRedisRepository, into_inner_or_panic, lock_or_recover,
};
use tearleads_api_v2::AdminServiceHandler;
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminDeleteRedisKeyRequest, admin_service_server::AdminService,
};
use tonic::{Code, Request};

#[tokio::test]
async fn delete_redis_key_trims_key_and_maps_repository_response() {
    let redis_repo = FakeRedisRepository {
        delete_key_result: Ok(true),
        ..Default::default()
    };
    let delete_key_calls = Arc::clone(&redis_repo.delete_key_calls);
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresGateway::default(),
        redis_repo,
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .delete_redis_key(Request::new(AdminDeleteRedisKeyRequest {
                key: String::from("  session:42  "),
            }))
            .await,
    );

    assert!(payload.deleted);
    assert_eq!(
        lock_or_recover(&delete_key_calls).clone(),
        vec![String::from("session:42")]
    );
}

#[tokio::test]
async fn delete_redis_key_rejects_empty_keys_before_repository_calls() {
    let redis_repo = FakeRedisRepository::default();
    let delete_key_calls = Arc::clone(&redis_repo.delete_key_calls);
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresGateway::default(),
        redis_repo,
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .delete_redis_key(Request::new(AdminDeleteRedisKeyRequest {
            key: String::from("   "),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("blank redis keys must fail validation"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(status.message(), "key must not be empty");
    assert!(lock_or_recover(&delete_key_calls).is_empty());
}

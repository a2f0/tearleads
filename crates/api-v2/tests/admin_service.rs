//! Integration tests for the v2 admin service handler core.

use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex},
};

mod support;

use support::admin_service::{
    FakeAuthorizer, FakePostgresRepository, FakeRedisRepository, into_inner_or_panic,
    lock_or_recover,
};
use tearleads_api_v2::{AdminAuthErrorKind, AdminOperation, AdminServiceHandler};
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminGetColumnsRequest, AdminGetPostgresInfoRequest, AdminGetRedisKeysRequest,
    AdminGetRedisValueRequest, AdminGetTablesRequest, AdminRedisStringList, AdminRedisStringMap,
    admin_redis_value, admin_service_server::AdminService,
};
use tearleads_data_access_traits::{
    DataAccessError, DataAccessErrorKind, PostgresColumnInfo, PostgresConnectionInfo,
    PostgresInfoSnapshot, PostgresTableInfo, RedisKeyInfo, RedisKeyScanPage, RedisKeyValueRecord,
    RedisValue,
};
use tonic::{Code, Request, Status};

#[tokio::test]
async fn postgres_info_maps_snapshot_to_contract_response() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresRepository {
            info_result: Ok(PostgresInfoSnapshot {
                connection: PostgresConnectionInfo {
                    host: Some(String::from("localhost")),
                    port: Some(5432),
                    database: Some(String::from("tearleads")),
                    user: Some(String::from("tearleads")),
                },
                server_version: Some(String::from("PostgreSQL 16.4")),
            }),
            ..Default::default()
        },
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .get_postgres_info(Request::new(AdminGetPostgresInfoRequest {}))
            .await,
    );

    assert!(payload.info.is_some());
    let info = payload.info.unwrap_or_default();
    assert_eq!(info.host.as_deref(), Some("localhost"));
    assert_eq!(info.port, Some(5432));
    assert_eq!(info.database.as_deref(), Some("tearleads"));
    assert_eq!(info.user.as_deref(), Some("tearleads"));
    assert_eq!(payload.server_version.as_deref(), Some("PostgreSQL 16.4"));
}

#[tokio::test]
async fn get_tables_maps_rows_to_contract_shape() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresRepository {
            tables_result: Ok(vec![PostgresTableInfo {
                schema: String::from("public"),
                name: String::from("users"),
                row_count: 12,
                total_bytes: 2048,
                table_bytes: 1024,
                index_bytes: 1024,
            }]),
            ..Default::default()
        },
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .get_tables(Request::new(AdminGetTablesRequest {}))
            .await,
    );

    assert_eq!(payload.tables.len(), 1);
    assert_eq!(payload.tables[0].schema, "public");
    assert_eq!(payload.tables[0].name, "users");
    assert_eq!(payload.tables[0].row_count, 12);
    assert_eq!(payload.tables[0].total_bytes, 2048);
    assert_eq!(payload.tables[0].table_bytes, 1024);
    assert_eq!(payload.tables[0].index_bytes, 1024);
}

#[tokio::test]
async fn default_constructor_applies_header_role_authorizer() {
    let handler = AdminServiceHandler::new(
        FakePostgresRepository {
            tables_result: Ok(vec![PostgresTableInfo {
                schema: String::from("public"),
                name: String::from("users"),
                row_count: 7,
                total_bytes: 70,
                table_bytes: 60,
                index_bytes: 10,
            }]),
            ..Default::default()
        },
        FakeRedisRepository::default(),
    );
    let mut request = Request::new(AdminGetTablesRequest {});
    request.metadata_mut().insert(
        "x-tearleads-role",
        tonic::metadata::MetadataValue::from_static("admin"),
    );
    request.metadata_mut().insert(
        "x-tearleads-admin-scope",
        tonic::metadata::MetadataValue::from_static("root"),
    );

    let payload = into_inner_or_panic(handler.get_tables(request).await);
    assert_eq!(payload.tables.len(), 1);
    assert_eq!(payload.tables[0].name, "users");
}

#[tokio::test]
async fn default_constructor_rejects_missing_role_header() {
    let handler = AdminServiceHandler::new(
        FakePostgresRepository::default(),
        FakeRedisRepository::default(),
    );

    let result = handler
        .get_tables(Request::new(AdminGetTablesRequest {}))
        .await;
    let status = match result {
        Ok(_) => panic!("missing role header must fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::Unauthenticated);
    assert!(status.message().contains("missing x-tearleads-role"));
}

#[tokio::test]
async fn get_columns_forwards_request_schema_table_and_maps_response() {
    let postgres_repo = FakePostgresRepository {
        columns_result: Ok(vec![PostgresColumnInfo {
            name: String::from("id"),
            data_type: String::from("uuid"),
            nullable: false,
            default_value: None,
            ordinal_position: 1,
        }]),
        ..Default::default()
    };
    let columns_calls = Arc::clone(&postgres_repo.columns_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .get_columns(Request::new(AdminGetColumnsRequest {
                schema: String::from("public"),
                table: String::from("users"),
            }))
            .await,
    );

    assert_eq!(payload.columns.len(), 1);
    assert_eq!(payload.columns[0].name, "id");
    assert_eq!(payload.columns[0].r#type, "uuid");
    assert!(!payload.columns[0].nullable);
    assert_eq!(payload.columns[0].default_value, None);
    assert_eq!(payload.columns[0].ordinal_position, 1);
    assert_eq!(
        lock_or_recover(&columns_calls).clone(),
        vec![(String::from("public"), String::from("users"))]
    );
}

#[tokio::test]
async fn get_redis_keys_passes_non_negative_limit_to_repository() {
    let redis_repo = FakeRedisRepository {
        list_keys_result: Ok(RedisKeyScanPage {
            keys: vec![RedisKeyInfo {
                key: String::from("session:123"),
                key_type: String::from("string"),
                ttl_seconds: 120,
            }],
            cursor: String::from("8"),
            has_more: true,
        }),
        ..Default::default()
    };
    let list_keys_calls = Arc::clone(&redis_repo.list_keys_calls);
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresRepository::default(),
        redis_repo,
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .get_redis_keys(Request::new(AdminGetRedisKeysRequest {
                cursor: String::from("4"),
                limit: 7,
            }))
            .await,
    );

    assert_eq!(
        lock_or_recover(&list_keys_calls).clone(),
        vec![(String::from("4"), 7)]
    );
    assert_eq!(payload.cursor, "8");
    assert!(payload.has_more);
    assert_eq!(payload.keys.len(), 1);
    assert_eq!(payload.keys[0].key, "session:123");
    assert_eq!(payload.keys[0].r#type, "string");
    assert_eq!(payload.keys[0].ttl, 120);
}

#[tokio::test]
async fn get_redis_keys_rejects_negative_limits() {
    let redis_repo = FakeRedisRepository::default();
    let list_keys_calls = Arc::clone(&redis_repo.list_keys_calls);
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresRepository::default(),
        redis_repo,
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_redis_keys(Request::new(AdminGetRedisKeysRequest {
            cursor: String::from("4"),
            limit: -1,
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("negative limits must fail validation"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(status.message(), "limit must be non-negative");
    assert!(lock_or_recover(&list_keys_calls).is_empty());
}

#[tokio::test]
async fn get_redis_value_maps_string_list_map_and_none_variants() {
    let variants = vec![
        (
            Some(RedisValue::String(String::from("value"))),
            Some(admin_redis_value::Value::StringValue(String::from("value"))),
        ),
        (
            Some(RedisValue::List(vec![String::from("a"), String::from("b")])),
            Some(admin_redis_value::Value::ListValue(AdminRedisStringList {
                values: vec![String::from("a"), String::from("b")],
            })),
        ),
        (
            Some(RedisValue::Map(BTreeMap::from([
                (String::from("x"), String::from("1")),
                (String::from("y"), String::from("2")),
            ]))),
            Some(admin_redis_value::Value::MapValue(AdminRedisStringMap {
                entries: HashMap::from([
                    (String::from("x"), String::from("1")),
                    (String::from("y"), String::from("2")),
                ]),
            })),
        ),
        (None, None),
    ];

    for (value, expected_oneof) in variants {
        let redis_repo = FakeRedisRepository {
            get_value_result: Ok(RedisKeyValueRecord {
                key: String::from("session:42"),
                key_type: String::from("string"),
                ttl_seconds: 11,
                value,
            }),
            ..Default::default()
        };
        let get_value_calls = Arc::clone(&redis_repo.get_value_calls);
        let handler = AdminServiceHandler::with_authorizer(
            FakePostgresRepository::default(),
            redis_repo,
            FakeAuthorizer::allow_all(),
        );

        let payload = into_inner_or_panic(
            handler
                .get_redis_value(Request::new(AdminGetRedisValueRequest {
                    key: String::from("  session:42  "),
                }))
                .await,
        );

        assert_eq!(payload.key, "session:42");
        assert_eq!(payload.r#type, "string");
        assert_eq!(payload.ttl, 11);
        let actual_oneof = payload.value.and_then(|value| value.value);
        assert_eq!(actual_oneof, expected_oneof);
        assert_eq!(
            lock_or_recover(&get_value_calls).clone(),
            vec![String::from("session:42")]
        );
    }
}

#[tokio::test]
async fn get_columns_rejects_invalid_identifiers_before_repository_calls() {
    let postgres_repo = FakePostgresRepository::default();
    let columns_calls = Arc::clone(&postgres_repo.columns_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_columns(Request::new(AdminGetColumnsRequest {
            schema: String::from("public;drop"),
            table: String::from("users"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("unsafe identifiers must fail validation"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::InvalidArgument);
    assert!(
        status
            .message()
            .contains("identifier must contain only ASCII letters"),
        "validation message should explain allowed characters"
    );
    assert!(lock_or_recover(&columns_calls).is_empty());
}

#[tokio::test]
async fn get_redis_value_rejects_empty_keys_before_repository_calls() {
    let redis_repo = FakeRedisRepository::default();
    let get_value_calls = Arc::clone(&redis_repo.get_value_calls);
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresRepository::default(),
        redis_repo,
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_redis_value(Request::new(AdminGetRedisValueRequest {
            key: String::from("   "),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("blank redis keys must fail validation"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(status.message(), "key must not be empty");
    assert!(lock_or_recover(&get_value_calls).is_empty());
}

#[tokio::test]
async fn repository_errors_map_to_expected_grpc_status_codes() {
    let cases = vec![
        (DataAccessErrorKind::NotFound, Code::NotFound),
        (
            DataAccessErrorKind::PermissionDenied,
            Code::PermissionDenied,
        ),
        (DataAccessErrorKind::InvalidInput, Code::InvalidArgument),
        (DataAccessErrorKind::Unavailable, Code::Unavailable),
        (DataAccessErrorKind::Internal, Code::Internal),
    ];

    for (kind, expected_code) in cases {
        let handler = AdminServiceHandler::with_authorizer(
            FakePostgresRepository {
                tables_result: Err(DataAccessError::new(kind, "boom")),
                ..Default::default()
            },
            FakeRedisRepository::default(),
            FakeAuthorizer::allow_all(),
        );

        let result = handler
            .get_tables(Request::new(AdminGetTablesRequest {}))
            .await;
        let status = match result {
            Ok(_) => panic!("table call should fail for {kind:?}"),
            Err(error) => error,
        };
        assert_eq!(status.code(), expected_code);
        let expected_message = match kind {
            DataAccessErrorKind::Unavailable => "upstream store unavailable",
            DataAccessErrorKind::Internal => "internal data access error",
            _ => "boom",
        };
        assert_eq!(status.message(), expected_message);
    }
}

#[tokio::test]
async fn authorizer_denial_short_circuits_repository_calls() {
    let postgres_repo = FakePostgresRepository {
        tables_result: Ok(vec![PostgresTableInfo {
            schema: String::from("public"),
            name: String::from("users"),
            row_count: 1,
            total_bytes: 1,
            table_bytes: 1,
            index_bytes: 0,
        }]),
        ..Default::default()
    };
    let authorizer = FakeAuthorizer::deny(AdminAuthErrorKind::PermissionDenied, "not admin");
    let calls = Arc::clone(&authorizer.calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        authorizer,
    );

    let result = handler
        .get_tables(Request::new(AdminGetTablesRequest {}))
        .await;
    let status = match result {
        Ok(_) => panic!("denied requests must fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::PermissionDenied);
    assert_eq!(status.message(), "not admin");
    assert_eq!(
        lock_or_recover(&calls).clone(),
        vec![AdminOperation::GetTables]
    );
}

#[test]
#[should_panic(expected = "unexpected status")]
fn into_inner_or_panic_panics_for_error_results() {
    let _: tearleads_api_v2_contracts::tearleads::v2::AdminGetTablesResponse =
        into_inner_or_panic(Err(Status::internal("boom")));
}

#[test]
fn lock_or_recover_handles_poisoned_mutex() {
    let mutex = Mutex::new(vec![String::from("seed")]);
    let _ = std::panic::catch_unwind(|| {
        let mut guard = lock_or_recover(&mutex);
        guard.push(String::from("poison"));
        panic!("poison mutex intentionally");
    });

    let guard = lock_or_recover(&mutex);
    assert_eq!(guard.len(), 2);
    assert_eq!(guard[0], "seed");
    assert_eq!(guard[1], "poison");
}

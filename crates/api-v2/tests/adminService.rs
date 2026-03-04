//! Integration tests for the v2 admin service handler core.

use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex, MutexGuard},
};

use tearleads_api_v2::AdminServiceHandler;
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminGetColumnsRequest, AdminGetPostgresInfoRequest, AdminGetRedisKeysRequest,
    AdminGetRedisValueRequest, AdminGetTablesRequest, AdminRedisStringList, AdminRedisStringMap,
    admin_redis_value, admin_service_server::AdminService,
};
use tearleads_data_access_traits::{
    BoxFuture, DataAccessError, DataAccessErrorKind, PostgresAdminReadRepository,
    PostgresColumnInfo, PostgresConnectionInfo, PostgresInfoSnapshot, PostgresTableInfo,
    RedisAdminReadRepository, RedisKeyInfo, RedisKeyScanPage, RedisKeyValueRecord, RedisValue,
};
use tonic::{Code, Request, Response, Status};

#[derive(Debug)]
struct FakePostgresRepository {
    info_result: Result<PostgresInfoSnapshot, DataAccessError>,
    tables_result: Result<Vec<PostgresTableInfo>, DataAccessError>,
    columns_result: Result<Vec<PostgresColumnInfo>, DataAccessError>,
    columns_calls: Arc<Mutex<Vec<(String, String)>>>,
}

impl Default for FakePostgresRepository {
    fn default() -> Self {
        Self {
            info_result: Ok(PostgresInfoSnapshot::default()),
            tables_result: Ok(Vec::new()),
            columns_result: Ok(Vec::new()),
            columns_calls: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl PostgresAdminReadRepository for FakePostgresRepository {
    fn get_postgres_info(&self) -> BoxFuture<'_, Result<PostgresInfoSnapshot, DataAccessError>> {
        let result = self.info_result.clone();
        Box::pin(async move { result })
    }

    fn list_tables(&self) -> BoxFuture<'_, Result<Vec<PostgresTableInfo>, DataAccessError>> {
        let result = self.tables_result.clone();
        Box::pin(async move { result })
    }

    fn list_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> BoxFuture<'_, Result<Vec<PostgresColumnInfo>, DataAccessError>> {
        lock_or_recover(&self.columns_calls).push((schema.to_string(), table.to_string()));
        let result = self.columns_result.clone();
        Box::pin(async move { result })
    }
}

#[derive(Debug)]
struct FakeRedisRepository {
    list_keys_result: Result<RedisKeyScanPage, DataAccessError>,
    get_value_result: Result<RedisKeyValueRecord, DataAccessError>,
    list_keys_calls: Arc<Mutex<Vec<(String, u32)>>>,
    get_value_calls: Arc<Mutex<Vec<String>>>,
}

impl Default for FakeRedisRepository {
    fn default() -> Self {
        Self {
            list_keys_result: Ok(RedisKeyScanPage {
                keys: Vec::new(),
                cursor: String::from("0"),
                has_more: false,
            }),
            get_value_result: Ok(RedisKeyValueRecord {
                key: String::from("sample"),
                key_type: String::from("string"),
                ttl_seconds: -1,
                value: None,
            }),
            list_keys_calls: Arc::new(Mutex::new(Vec::new())),
            get_value_calls: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl RedisAdminReadRepository for FakeRedisRepository {
    fn list_keys(
        &self,
        cursor: &str,
        limit: u32,
    ) -> BoxFuture<'_, Result<RedisKeyScanPage, DataAccessError>> {
        lock_or_recover(&self.list_keys_calls).push((cursor.to_string(), limit));
        let result = self.list_keys_result.clone();
        Box::pin(async move { result })
    }

    fn get_value(&self, key: &str) -> BoxFuture<'_, Result<RedisKeyValueRecord, DataAccessError>> {
        lock_or_recover(&self.get_value_calls).push(key.to_string());
        let result = self.get_value_result.clone();
        Box::pin(async move { result })
    }
}

#[tokio::test]
async fn postgres_info_maps_snapshot_to_contract_response() {
    let handler = AdminServiceHandler::new(
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
    let handler = AdminServiceHandler::new(
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
    let handler = AdminServiceHandler::new(postgres_repo, FakeRedisRepository::default());

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
async fn get_redis_keys_converts_negative_limits_to_zero_for_repo_normalization() {
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
    let handler = AdminServiceHandler::new(FakePostgresRepository::default(), redis_repo);

    let payload = into_inner_or_panic(
        handler
            .get_redis_keys(Request::new(AdminGetRedisKeysRequest {
                cursor: String::from("4"),
                limit: -7,
            }))
            .await,
    );

    assert_eq!(
        lock_or_recover(&list_keys_calls).clone(),
        vec![(String::from("4"), 0)]
    );
    assert_eq!(payload.cursor, "8");
    assert!(payload.has_more);
    assert_eq!(payload.keys.len(), 1);
    assert_eq!(payload.keys[0].key, "session:123");
    assert_eq!(payload.keys[0].r#type, "string");
    assert_eq!(payload.keys[0].ttl, 120);
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
        let handler = AdminServiceHandler::new(FakePostgresRepository::default(), redis_repo);

        let payload = into_inner_or_panic(
            handler
                .get_redis_value(Request::new(AdminGetRedisValueRequest {
                    key: String::from("session:42"),
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
        let handler = AdminServiceHandler::new(
            FakePostgresRepository {
                tables_result: Err(DataAccessError::new(kind, "boom")),
                ..Default::default()
            },
            FakeRedisRepository::default(),
        );

        let result = handler
            .get_tables(Request::new(AdminGetTablesRequest {}))
            .await;
        let status = match result {
            Ok(_) => panic!("table call should fail for {kind:?}"),
            Err(error) => error,
        };
        assert_eq!(status.code(), expected_code);
        assert_eq!(status.message(), "boom");
    }
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

fn into_inner_or_panic<T>(result: Result<Response<T>, Status>) -> T {
    match result {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("unexpected status: {error}"),
    }
}

fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

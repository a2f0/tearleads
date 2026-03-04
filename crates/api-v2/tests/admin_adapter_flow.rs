//! Integration tests for handler -> adapter -> gateway flows in Wave 1A.

use std::sync::{Arc, Mutex, MutexGuard};

use tearleads_api_v2::AdminServiceHandler;
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminGetColumnsRequest, AdminGetPostgresInfoRequest, AdminGetRedisDbSizeRequest,
    AdminGetRedisKeysRequest, AdminGetRedisValueRequest, AdminGetRowsRequest,
    AdminGetTablesRequest, admin_redis_value, admin_service_server::AdminService,
};
use tearleads_data_access_postgres::{
    PostgresAdminGateway, PostgresAdminReadAdapter, PostgresColumnRecord, PostgresRowsPageRecord,
    PostgresTableRecord,
};
use tearleads_data_access_redis::{
    RedisAdminGateway, RedisAdminReadAdapter, RedisKeyRecord, RedisScanResult,
};
use tearleads_data_access_traits::{
    BoxFuture, DataAccessError, PostgresConnectionInfo, PostgresRowsQuery, RedisValue,
};
use tonic::{Code, Request, metadata::MetadataValue};

#[derive(Debug, Default)]
struct PostgresGatewayCalls {
    list_tables_calls: usize,
    table_exists_calls: Vec<(String, String)>,
    list_columns_calls: Vec<(String, String)>,
    list_rows_calls: Vec<PostgresRowsQuery>,
}

#[derive(Debug)]
struct FakePostgresGateway {
    connection_info: PostgresConnectionInfo,
    server_version: Option<String>,
    tables: Vec<PostgresTableRecord>,
    table_exists: bool,
    columns: Vec<PostgresColumnRecord>,
    rows_page: PostgresRowsPageRecord,
    calls: Arc<Mutex<PostgresGatewayCalls>>,
}

impl Default for FakePostgresGateway {
    fn default() -> Self {
        Self {
            connection_info: PostgresConnectionInfo::default(),
            server_version: None,
            tables: Vec::new(),
            table_exists: true,
            columns: Vec::new(),
            rows_page: PostgresRowsPageRecord {
                rows_json: Vec::new(),
                total_count: 0,
                limit: 0,
                offset: 0,
            },
            calls: Arc::new(Mutex::new(PostgresGatewayCalls::default())),
        }
    }
}

impl PostgresAdminGateway for FakePostgresGateway {
    fn connection_info(&self) -> PostgresConnectionInfo {
        self.connection_info.clone()
    }

    fn fetch_server_version(&self) -> BoxFuture<'_, Result<Option<String>, DataAccessError>> {
        let result = self.server_version.clone();
        Box::pin(async move { Ok(result) })
    }

    fn list_tables(&self) -> BoxFuture<'_, Result<Vec<PostgresTableRecord>, DataAccessError>> {
        lock_or_recover(&self.calls).list_tables_calls += 1;
        let result = self.tables.clone();
        Box::pin(async move { Ok(result) })
    }

    fn table_exists(
        &self,
        schema: &str,
        table: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        lock_or_recover(&self.calls)
            .table_exists_calls
            .push((schema.to_string(), table.to_string()));
        let result = self.table_exists;
        Box::pin(async move { Ok(result) })
    }

    fn list_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> BoxFuture<'_, Result<Vec<PostgresColumnRecord>, DataAccessError>> {
        lock_or_recover(&self.calls)
            .list_columns_calls
            .push((schema.to_string(), table.to_string()));
        let result = self.columns.clone();
        Box::pin(async move { Ok(result) })
    }

    fn list_rows(
        &self,
        query: &PostgresRowsQuery,
    ) -> BoxFuture<'_, Result<PostgresRowsPageRecord, DataAccessError>> {
        lock_or_recover(&self.calls)
            .list_rows_calls
            .push(query.clone());
        let result = self.rows_page.clone();
        Box::pin(async move { Ok(result) })
    }
}

#[derive(Debug, Default)]
struct RedisGatewayCalls {
    scan_calls: Vec<(String, u32)>,
    read_key_calls: Vec<String>,
    db_size_calls: usize,
}

#[derive(Debug)]
struct FakeRedisGateway {
    scan_result: RedisScanResult,
    read_result: RedisKeyRecord,
    db_size: u64,
    calls: Arc<Mutex<RedisGatewayCalls>>,
}

impl Default for FakeRedisGateway {
    fn default() -> Self {
        Self {
            scan_result: RedisScanResult {
                keys: Vec::new(),
                next_cursor: String::from("0"),
            },
            read_result: RedisKeyRecord {
                key: String::from("sample"),
                key_type: String::from("string"),
                ttl_seconds: -1,
                value: None,
            },
            db_size: 0,
            calls: Arc::new(Mutex::new(RedisGatewayCalls::default())),
        }
    }
}

impl RedisAdminGateway for FakeRedisGateway {
    fn scan_keys(
        &self,
        cursor: &str,
        limit: u32,
    ) -> BoxFuture<'_, Result<RedisScanResult, DataAccessError>> {
        lock_or_recover(&self.calls)
            .scan_calls
            .push((cursor.to_string(), limit));
        let result = self.scan_result.clone();
        Box::pin(async move { Ok(result) })
    }

    fn read_key(&self, key: &str) -> BoxFuture<'_, Result<RedisKeyRecord, DataAccessError>> {
        lock_or_recover(&self.calls)
            .read_key_calls
            .push(key.to_string());
        let result = self.read_result.clone();
        Box::pin(async move { Ok(result) })
    }

    fn read_db_size(&self) -> BoxFuture<'_, Result<u64, DataAccessError>> {
        lock_or_recover(&self.calls).db_size_calls += 1;
        let result = self.db_size;
        Box::pin(async move { Ok(result) })
    }
}

fn admin_request<T>(payload: T) -> Request<T> {
    let mut request = Request::new(payload);
    request
        .metadata_mut()
        .insert("x-tearleads-role", MetadataValue::from_static("admin"));
    request
}

#[tokio::test]
async fn postgres_info_and_tables_flow_through_adapter_and_gateway() {
    let postgres_gateway = FakePostgresGateway {
        connection_info: PostgresConnectionInfo {
            host: Some(String::from("localhost")),
            port: Some(5432),
            database: Some(String::from("tearleads")),
            user: Some(String::from("tearleads")),
        },
        server_version: Some(String::from("PostgreSQL 16.7")),
        tables: vec![PostgresTableRecord {
            schema: String::from("public"),
            name: String::from("users"),
            row_count: 9,
            total_bytes: 1000,
            table_bytes: 600,
            index_bytes: 400,
        }],
        rows_page: PostgresRowsPageRecord {
            rows_json: vec![String::from("{\"id\":\"user-1\"}")],
            total_count: 1,
            limit: 10,
            offset: 20,
        },
        ..Default::default()
    };
    let postgres_calls = Arc::clone(&postgres_gateway.calls);
    let handler = AdminServiceHandler::new(
        PostgresAdminReadAdapter::new(postgres_gateway),
        RedisAdminReadAdapter::new(FakeRedisGateway::default()),
    );

    let info_response = match handler
        .get_postgres_info(admin_request(AdminGetPostgresInfoRequest {}))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_postgres_info should succeed: {error}"),
    };
    assert_eq!(
        info_response
            .info
            .as_ref()
            .and_then(|value| value.host.clone()),
        Some(String::from("localhost"))
    );
    assert_eq!(
        info_response.server_version.as_deref(),
        Some("PostgreSQL 16.7")
    );

    let tables_response = match handler
        .get_tables(admin_request(AdminGetTablesRequest {}))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_tables should succeed: {error}"),
    };
    assert_eq!(tables_response.tables.len(), 1);
    assert_eq!(tables_response.tables[0].name, "users");
    assert_eq!(tables_response.tables[0].row_count, 9);
    assert_eq!(lock_or_recover(&postgres_calls).list_tables_calls, 1);

    let rows_response = match handler
        .get_rows(admin_request(AdminGetRowsRequest {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 10,
            offset: 20,
            sort_column: Some(String::from("id")),
            sort_direction: Some(String::from("desc")),
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_rows should succeed: {error}"),
    };
    assert_eq!(
        rows_response.rows_json,
        vec![String::from("{\"id\":\"user-1\"}")]
    );
    assert_eq!(
        lock_or_recover(&postgres_calls).list_rows_calls,
        vec![PostgresRowsQuery {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 10,
            offset: 20,
            sort_column: Some(String::from("id")),
            sort_direction: Some(String::from("desc")),
        }]
    );
}

#[tokio::test]
async fn columns_flow_normalizes_schema_and_table_before_gateway_calls() {
    let postgres_gateway = FakePostgresGateway {
        columns: vec![PostgresColumnRecord {
            name: String::from("id"),
            data_type: String::from("uuid"),
            nullable: false,
            default_value: None,
            ordinal_position: 1,
        }],
        ..Default::default()
    };
    let postgres_calls = Arc::clone(&postgres_gateway.calls);
    let handler = AdminServiceHandler::new(
        PostgresAdminReadAdapter::new(postgres_gateway),
        RedisAdminReadAdapter::new(FakeRedisGateway::default()),
    );

    let response = match handler
        .get_columns(admin_request(AdminGetColumnsRequest {
            schema: String::from(" public "),
            table: String::from(" users "),
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_columns should succeed: {error}"),
    };

    assert_eq!(response.columns.len(), 1);
    assert_eq!(response.columns[0].name, "id");
    assert_eq!(
        lock_or_recover(&postgres_calls).table_exists_calls,
        vec![(String::from("public"), String::from("users"))]
    );
    assert_eq!(
        lock_or_recover(&postgres_calls).list_columns_calls,
        vec![(String::from("public"), String::from("users"))]
    );
}

#[tokio::test]
async fn redis_keys_and_value_flow_through_adapter_with_normalization() {
    let redis_gateway = FakeRedisGateway {
        scan_result: RedisScanResult {
            keys: vec![RedisKeyRecord {
                key: String::from("session:1"),
                key_type: String::from("string"),
                ttl_seconds: 120,
                value: None,
            }],
            next_cursor: String::from("8"),
        },
        read_result: RedisKeyRecord {
            key: String::from("session:1"),
            key_type: String::from("string"),
            ttl_seconds: 120,
            value: Some(RedisValue::String(String::from("payload"))),
        },
        db_size: 12,
        ..Default::default()
    };
    let redis_calls = Arc::clone(&redis_gateway.calls);
    let handler = AdminServiceHandler::new(
        PostgresAdminReadAdapter::new(FakePostgresGateway::default()),
        RedisAdminReadAdapter::new(redis_gateway),
    );

    let keys_response = match handler
        .get_redis_keys(admin_request(AdminGetRedisKeysRequest {
            cursor: String::from(" "),
            limit: 0,
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_redis_keys should succeed: {error}"),
    };
    assert_eq!(
        lock_or_recover(&redis_calls).scan_calls,
        vec![(String::from("0"), 50)]
    );
    assert_eq!(keys_response.keys.len(), 1);
    assert_eq!(keys_response.cursor, "8");
    assert!(keys_response.has_more);

    let value_response = match handler
        .get_redis_value(admin_request(AdminGetRedisValueRequest {
            key: String::from(" session:1 "),
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_redis_value should succeed: {error}"),
    };
    assert_eq!(
        lock_or_recover(&redis_calls).read_key_calls,
        vec![String::from("session:1")]
    );
    assert_eq!(
        value_response.value.and_then(|value| value.value),
        Some(admin_redis_value::Value::StringValue(String::from(
            "payload"
        )))
    );

    let db_size_response = match handler
        .get_redis_db_size(admin_request(AdminGetRedisDbSizeRequest {}))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_redis_db_size should succeed: {error}"),
    };
    assert_eq!(db_size_response.count, 12);
    assert_eq!(lock_or_recover(&redis_calls).db_size_calls, 1);
}

#[tokio::test]
async fn missing_role_header_short_circuits_before_gateway_calls() {
    let postgres_gateway = FakePostgresGateway::default();
    let postgres_calls = Arc::clone(&postgres_gateway.calls);
    let redis_gateway = FakeRedisGateway::default();
    let redis_calls = Arc::clone(&redis_gateway.calls);

    let handler = AdminServiceHandler::new(
        PostgresAdminReadAdapter::new(postgres_gateway),
        RedisAdminReadAdapter::new(redis_gateway),
    );

    let status = match handler
        .get_tables(Request::new(AdminGetTablesRequest {}))
        .await
    {
        Ok(_) => panic!("missing role header must fail"),
        Err(error) => error,
    };
    assert_eq!(status.code(), Code::Unauthenticated);
    assert!(status.message().contains("missing x-tearleads-role"));
    assert_eq!(lock_or_recover(&postgres_calls).list_tables_calls, 0);
    assert!(lock_or_recover(&redis_calls).scan_calls.is_empty());
}

fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

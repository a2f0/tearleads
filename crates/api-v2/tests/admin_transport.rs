//! Transport-level integration tests for v2 admin RPCs.

use std::net::SocketAddr;

use tearleads_api_v2::AdminServiceHandler;
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminDeleteRedisKeyRequest, AdminGetColumnsRequest, AdminGetPostgresInfoRequest,
    AdminGetRedisDbSizeRequest, AdminGetRedisKeysRequest, AdminGetRedisValueRequest,
    AdminGetRowsRequest, AdminGetTablesRequest, AdminListGroupsRequest, admin_redis_value,
    admin_service_client::AdminServiceClient, admin_service_server::AdminServiceServer,
};
use tearleads_data_access_traits::{
    AdminGroupSummary, AdminScopeOrganization, BoxFuture, DataAccessError,
    PostgresAdminReadRepository, PostgresColumnInfo, PostgresConnectionInfo, PostgresInfoSnapshot,
    PostgresRowsPage, PostgresRowsQuery, PostgresTableInfo, RedisAdminRepository, RedisKeyInfo,
    RedisKeyScanPage, RedisKeyValueRecord, RedisValue,
};
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle};
use tokio_stream::wrappers::TcpListenerStream;
use tonic::{
    Code, Request,
    transport::{Channel, Endpoint, Server},
};

#[derive(Debug)]
struct FakePostgresRepository {
    info_result: Result<PostgresInfoSnapshot, DataAccessError>,
    scope_organizations_result: Result<Vec<AdminScopeOrganization>, DataAccessError>,
    scope_organizations_by_ids_result: Result<Vec<AdminScopeOrganization>, DataAccessError>,
    groups_result: Result<Vec<AdminGroupSummary>, DataAccessError>,
    tables_result: Result<Vec<PostgresTableInfo>, DataAccessError>,
    columns_result: Result<Vec<PostgresColumnInfo>, DataAccessError>,
    rows_result: Result<PostgresRowsPage, DataAccessError>,
}

impl Default for FakePostgresRepository {
    fn default() -> Self {
        Self {
            info_result: Ok(PostgresInfoSnapshot::default()),
            scope_organizations_result: Ok(Vec::new()),
            scope_organizations_by_ids_result: Ok(Vec::new()),
            groups_result: Ok(Vec::new()),
            tables_result: Ok(Vec::new()),
            columns_result: Ok(Vec::new()),
            rows_result: Ok(PostgresRowsPage {
                rows_json: Vec::new(),
                total_count: 0,
                limit: 0,
                offset: 0,
            }),
        }
    }
}

impl PostgresAdminReadRepository for FakePostgresRepository {
    fn get_postgres_info(&self) -> BoxFuture<'_, Result<PostgresInfoSnapshot, DataAccessError>> {
        let result = self.info_result.clone();
        Box::pin(async move { result })
    }

    fn list_scope_organizations(
        &self,
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganization>, DataAccessError>> {
        let result = self.scope_organizations_result.clone();
        Box::pin(async move { result })
    }

    fn list_scope_organizations_by_ids(
        &self,
        _organization_ids: Vec<String>,
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganization>, DataAccessError>> {
        let result = self.scope_organizations_by_ids_result.clone();
        Box::pin(async move { result })
    }

    fn list_groups(
        &self,
        _organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminGroupSummary>, DataAccessError>> {
        let result = self.groups_result.clone();
        Box::pin(async move { result })
    }

    fn list_tables(&self) -> BoxFuture<'_, Result<Vec<PostgresTableInfo>, DataAccessError>> {
        let result = self.tables_result.clone();
        Box::pin(async move { result })
    }

    fn list_columns(
        &self,
        _schema: &str,
        _table: &str,
    ) -> BoxFuture<'_, Result<Vec<PostgresColumnInfo>, DataAccessError>> {
        let result = self.columns_result.clone();
        Box::pin(async move { result })
    }

    fn list_rows(
        &self,
        _query: PostgresRowsQuery,
    ) -> BoxFuture<'_, Result<PostgresRowsPage, DataAccessError>> {
        let result = self.rows_result.clone();
        Box::pin(async move { result })
    }
}

#[derive(Debug)]
struct FakeRedisRepository {
    list_keys_result: Result<RedisKeyScanPage, DataAccessError>,
    get_value_result: Result<RedisKeyValueRecord, DataAccessError>,
    delete_key_result: Result<bool, DataAccessError>,
    db_size_result: Result<u64, DataAccessError>,
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
            delete_key_result: Ok(false),
            db_size_result: Ok(0),
        }
    }
}

impl RedisAdminRepository for FakeRedisRepository {
    fn list_keys(
        &self,
        _cursor: &str,
        _limit: u32,
    ) -> BoxFuture<'_, Result<RedisKeyScanPage, DataAccessError>> {
        let result = self.list_keys_result.clone();
        Box::pin(async move { result })
    }

    fn get_value(&self, _key: &str) -> BoxFuture<'_, Result<RedisKeyValueRecord, DataAccessError>> {
        let result = self.get_value_result.clone();
        Box::pin(async move { result })
    }

    fn delete_key(&self, _key: &str) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let result = self.delete_key_result.clone();
        Box::pin(async move { result })
    }

    fn get_db_size(&self) -> BoxFuture<'_, Result<u64, DataAccessError>> {
        let result = self.db_size_result.clone();
        Box::pin(async move { result })
    }
}

struct AdminTransportHarness {
    client: AdminServiceClient<Channel>,
    shutdown_tx: oneshot::Sender<()>,
    server_task: JoinHandle<()>,
}

async fn spawn_admin_transport(
    postgres_repo: FakePostgresRepository,
    redis_repo: FakeRedisRepository,
) -> AdminTransportHarness {
    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(value) => value,
        Err(error) => panic!("failed to bind test listener: {error}"),
    };
    let address = match listener.local_addr() {
        Ok(value) => value,
        Err(error) => panic!("failed to read test listener address: {error}"),
    };
    let incoming = TcpListenerStream::new(listener);
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let service = AdminServiceServer::new(AdminServiceHandler::new(postgres_repo, redis_repo));
    let server_task = tokio::spawn(async move {
        let serve_result = Server::builder()
            .add_service(service)
            .serve_with_incoming_shutdown(incoming, async move {
                let _ignored = shutdown_rx.await;
            })
            .await;

        if let Err(error) = serve_result {
            panic!("admin transport test server failed: {error}");
        }
    });

    let endpoint = endpoint_for(address);
    let channel = match Endpoint::from_shared(endpoint) {
        Ok(value) => value,
        Err(error) => {
            let _ignored = shutdown_tx.send(());
            let join_result = server_task.await;
            if let Err(join_error) = join_result {
                panic!(
                    "failed to parse admin transport endpoint ({error}); server join error: {join_error}"
                );
            }
            panic!("failed to parse admin transport endpoint: {error}");
        }
    };
    let channel = match channel.connect().await {
        Ok(value) => value,
        Err(error) => {
            let _ignored = shutdown_tx.send(());
            let join_result = server_task.await;
            if let Err(join_error) = join_result {
                panic!(
                    "failed to connect admin transport channel ({error}); server join error: {join_error}"
                );
            }
            panic!("failed to connect admin transport channel: {error}");
        }
    };
    let client = AdminServiceClient::new(channel);

    AdminTransportHarness {
        client,
        shutdown_tx,
        server_task,
    }
}

fn endpoint_for(address: SocketAddr) -> String {
    format!("http://{address}")
}

fn admin_request<T>(payload: T) -> Request<T> {
    let mut request = Request::new(payload);
    request.metadata_mut().insert(
        "x-tearleads-role",
        tonic::metadata::MetadataValue::from_static("admin"),
    );
    request.metadata_mut().insert(
        "x-tearleads-admin-scope",
        tonic::metadata::MetadataValue::from_static("root"),
    );
    request
}

async fn shutdown_admin_transport(harness: AdminTransportHarness) {
    let send_result = harness.shutdown_tx.send(());
    if send_result.is_err() {
        panic!("failed to send shutdown signal to admin transport test server");
    }

    let join_result = harness.server_task.await;
    if let Err(error) = join_result {
        panic!("admin transport test server task failed to join: {error}");
    }
}

#[tokio::test]
async fn transport_round_trip_for_wave1a_admin_endpoints() {
    let postgres_repo = FakePostgresRepository {
        info_result: Ok(PostgresInfoSnapshot {
            connection: PostgresConnectionInfo {
                host: Some(String::from("localhost")),
                port: Some(5432),
                database: Some(String::from("tearleads")),
                user: Some(String::from("tearleads")),
            },
            server_version: Some(String::from("PostgreSQL 16.6")),
        }),
        groups_result: Ok(vec![AdminGroupSummary {
            id: String::from("group-1"),
            organization_id: String::from("org-1"),
            name: String::from("Core Admin"),
            description: Some(String::from("Admin operators")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
            member_count: 2,
        }]),
        tables_result: Ok(vec![PostgresTableInfo {
            schema: String::from("public"),
            name: String::from("users"),
            row_count: 42,
            total_bytes: 8192,
            table_bytes: 4096,
            index_bytes: 4096,
        }]),
        columns_result: Ok(vec![PostgresColumnInfo {
            name: String::from("id"),
            data_type: String::from("uuid"),
            nullable: false,
            default_value: None,
            ordinal_position: 1,
        }]),
        rows_result: Ok(PostgresRowsPage {
            rows_json: vec![String::from("{\"id\":\"user-1\"}")],
            total_count: 1,
            limit: 10,
            offset: 20,
        }),
        ..Default::default()
    };
    let redis_repo = FakeRedisRepository {
        list_keys_result: Ok(RedisKeyScanPage {
            keys: vec![RedisKeyInfo {
                key: String::from("session:1"),
                key_type: String::from("string"),
                ttl_seconds: 180,
            }],
            cursor: String::from("9"),
            has_more: true,
        }),
        get_value_result: Ok(RedisKeyValueRecord {
            key: String::from("session:1"),
            key_type: String::from("string"),
            ttl_seconds: 180,
            value: Some(RedisValue::String(String::from("hello"))),
        }),
        delete_key_result: Ok(true),
        db_size_result: Ok(7),
    };
    let mut harness = spawn_admin_transport(postgres_repo, redis_repo).await;

    let info_response = match harness
        .client
        .get_postgres_info(admin_request(AdminGetPostgresInfoRequest {}))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_postgres_info should succeed over transport: {error}"),
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
        Some("PostgreSQL 16.6")
    );

    let mut list_groups_request = admin_request(AdminListGroupsRequest {
        organization_id: None,
    });
    list_groups_request.metadata_mut().insert(
        "x-tearleads-admin-scope",
        tonic::metadata::MetadataValue::from_static("root"),
    );

    let list_groups_response = match harness.client.list_groups(list_groups_request).await {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("list_groups should succeed over transport: {error}"),
    };
    assert_eq!(list_groups_response.groups.len(), 1);
    assert_eq!(list_groups_response.groups[0].name, "Core Admin");

    let tables_response = match harness
        .client
        .get_tables(admin_request(AdminGetTablesRequest {}))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_tables should succeed over transport: {error}"),
    };
    assert_eq!(tables_response.tables.len(), 1);
    assert_eq!(tables_response.tables[0].name, "users");
    assert_eq!(tables_response.tables[0].row_count, 42);

    let columns_response = match harness
        .client
        .get_columns(admin_request(AdminGetColumnsRequest {
            schema: String::from(" public "),
            table: String::from(" users "),
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_columns should succeed over transport: {error}"),
    };
    assert_eq!(columns_response.columns.len(), 1);
    assert_eq!(columns_response.columns[0].name, "id");
    assert_eq!(columns_response.columns[0].r#type, "uuid");

    let rows_response = match harness
        .client
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
        Err(error) => panic!("get_rows should succeed over transport: {error}"),
    };
    assert_eq!(rows_response.rows.len(), 1);
    assert!(rows_response.rows[0].fields.contains_key("id"));
    assert_eq!(rows_response.total_count, 1);
    assert_eq!(rows_response.limit, 10);
    assert_eq!(rows_response.offset, 20);

    let keys_response = match harness
        .client
        .get_redis_keys(admin_request(AdminGetRedisKeysRequest {
            cursor: String::from("4"),
            limit: 10,
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_redis_keys should succeed over transport: {error}"),
    };
    assert_eq!(keys_response.keys.len(), 1);
    assert_eq!(keys_response.keys[0].key, "session:1");
    assert_eq!(keys_response.cursor, "9");
    assert!(keys_response.has_more);

    let value_response = match harness
        .client
        .get_redis_value(admin_request(AdminGetRedisValueRequest {
            key: String::from(" session:1 "),
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_redis_value should succeed over transport: {error}"),
    };
    assert_eq!(value_response.key, "session:1");
    assert_eq!(
        value_response.value.and_then(|value| value.value),
        Some(admin_redis_value::Value::StringValue(String::from("hello")))
    );

    let delete_response = match harness
        .client
        .delete_redis_key(admin_request(AdminDeleteRedisKeyRequest {
            key: String::from("session:1"),
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("delete_redis_key should succeed over transport: {error}"),
    };
    assert!(delete_response.deleted);

    let db_size_response = match harness
        .client
        .get_redis_db_size(admin_request(AdminGetRedisDbSizeRequest {}))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_redis_db_size should succeed over transport: {error}"),
    };
    assert_eq!(db_size_response.count, 7);

    shutdown_admin_transport(harness).await;
}

#[tokio::test]
async fn transport_rejects_requests_without_admin_role_metadata() {
    let mut harness = spawn_admin_transport(
        FakePostgresRepository::default(),
        FakeRedisRepository::default(),
    )
    .await;

    let result = harness
        .client
        .get_tables(Request::new(AdminGetTablesRequest {}))
        .await;
    let status = match result {
        Ok(_) => panic!("missing x-tearleads-role should fail over transport"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::Unauthenticated);
    assert!(status.message().contains("missing x-tearleads-role"));

    shutdown_admin_transport(harness).await;
}

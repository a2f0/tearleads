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
    AdminCreateGroupInput, AdminCreateOrganizationInput, AdminGroupDetail, AdminGroupSummary,
    AdminOrganizationSummary, AdminOrganizationUserSummary, AdminScopeOrganization,
    AdminUpdateGroupInput, AdminUpdateOrganizationInput, AdminUpdateUserInput, AdminUserSummary,
    BoxFuture, DataAccessError, DataAccessErrorKind, PostgresAdminRepository, PostgresColumnInfo,
    PostgresConnectionInfo, PostgresInfoSnapshot, PostgresRowsPage, PostgresRowsQuery,
    PostgresTableInfo, RedisAdminRepository, RedisKeyInfo, RedisKeyScanPage, RedisKeyValueRecord,
    RedisValue,
};
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle};
use tokio_stream::wrappers::TcpListenerStream;
use tonic::{
    Code, Request,
    transport::{Channel, Endpoint, Server},
};

#[path = "admin_transport/round_trip.rs"]
mod round_trip;

#[derive(Debug)]
struct FakePostgresGateway {
    info_result: Result<PostgresInfoSnapshot, DataAccessError>,
    scope_organizations_result: Result<Vec<AdminScopeOrganization>, DataAccessError>,
    scope_organizations_by_ids_result: Result<Vec<AdminScopeOrganization>, DataAccessError>,
    groups_result: Result<Vec<AdminGroupSummary>, DataAccessError>,
    tables_result: Result<Vec<PostgresTableInfo>, DataAccessError>,
    columns_result: Result<Vec<PostgresColumnInfo>, DataAccessError>,
    rows_result: Result<PostgresRowsPage, DataAccessError>,
}

impl Default for FakePostgresGateway {
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

impl PostgresAdminRepository for FakePostgresGateway {
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

    fn get_group(
        &self,
        _group_id: &str,
    ) -> BoxFuture<'_, Result<AdminGroupDetail, DataAccessError>> {
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "group detail is not implemented for transport fake",
            ))
        })
    }

    fn create_group(
        &self,
        _input: AdminCreateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetail, DataAccessError>> {
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "group create is not implemented for transport fake",
            ))
        })
    }

    fn update_group(
        &self,
        _group_id: &str,
        _input: AdminUpdateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetail, DataAccessError>> {
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "group update is not implemented for transport fake",
            ))
        })
    }

    fn delete_group(&self, _group_id: &str) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        Box::pin(async move { Ok(false) })
    }

    fn add_group_member(
        &self,
        _group_id: &str,
        _user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        Box::pin(async move { Ok(false) })
    }

    fn remove_group_member(
        &self,
        _group_id: &str,
        _user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        Box::pin(async move { Ok(false) })
    }

    fn list_organizations(
        &self,
        _organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationSummary>, DataAccessError>> {
        Box::pin(async move { Ok(Vec::new()) })
    }

    fn create_organization(
        &self,
        _input: AdminCreateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationSummary, DataAccessError>> {
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "organization create is not implemented for transport fake",
            ))
        })
    }

    fn update_organization(
        &self,
        _organization_id: &str,
        _input: AdminUpdateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationSummary, DataAccessError>> {
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "organization update is not implemented for transport fake",
            ))
        })
    }

    fn delete_organization(
        &self,
        _organization_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        Box::pin(async move { Ok(false) })
    }

    fn get_organization_users(
        &self,
        _organization_id: &str,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationUserSummary>, DataAccessError>> {
        Box::pin(async move { Ok(Vec::new()) })
    }

    fn list_users(
        &self,
        _organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminUserSummary>, DataAccessError>> {
        Box::pin(async move { Ok(Vec::new()) })
    }

    fn get_user(
        &self,
        _user_id: &str,
        _organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Option<AdminUserSummary>, DataAccessError>> {
        Box::pin(async move { Ok(None) })
    }

    fn update_user(
        &self,
        _user_id: &str,
        _input: AdminUpdateUserInput,
    ) -> BoxFuture<'_, Result<AdminUserSummary, DataAccessError>> {
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "user update is not implemented for transport fake",
            ))
        })
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
    postgres_repo: FakePostgresGateway,
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
async fn transport_rejects_requests_without_admin_role_metadata() {
    let mut harness = spawn_admin_transport(
        FakePostgresGateway::default(),
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

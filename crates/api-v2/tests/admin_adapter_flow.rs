//! Integration tests for handler -> adapter -> gateway flows in Wave 1A.

use std::sync::{Arc, Mutex, MutexGuard};

use tearleads_api_v2::AdminServiceHandler;
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminDeleteRedisKeyRequest, AdminGetColumnsRequest, AdminGetPostgresInfoRequest,
    AdminGetRedisDbSizeRequest, AdminGetRedisKeysRequest, AdminGetRedisValueRequest,
    AdminGetRowsRequest, AdminGetTablesRequest, admin_redis_value,
    admin_service_server::AdminService,
};
use tearleads_data_access_postgres::{
    AdminGroupDetailRecord, AdminGroupSummaryRecord, AdminOrganizationRecord,
    AdminOrganizationUserRecord, AdminScopeOrganizationRecord, AdminUserRecord,
    PostgresAdminAdapter, PostgresAdminGateway, PostgresColumnRecord, PostgresRowsPageRecord,
    PostgresTableRecord,
};
use tearleads_data_access_redis::{
    RedisAdminAdapter, RedisAdminGateway, RedisKeyRecord, RedisScanResult,
};
use tearleads_data_access_traits::{
    BoxFuture, DataAccessError, DataAccessErrorKind, PostgresConnectionInfo, PostgresRowsQuery,
    RedisValue,
};
use tonic::{Request, metadata::MetadataValue};

#[path = "admin_adapter_flow/auth_guards.rs"]
mod auth_guards;
#[path = "admin_adapter_flow/postgres_flow.rs"]
mod postgres_flow;
#[path = "admin_adapter_flow/redis_flow.rs"]
mod redis_flow;

#[derive(Debug, Default)]
struct PostgresGatewayCalls {
    list_scope_organizations_calls: usize,
    list_scope_organizations_by_ids_calls: Vec<Vec<String>>,
    list_tables_calls: usize,
    table_exists_calls: Vec<(String, String)>,
    list_columns_calls: Vec<(String, String)>,
    list_rows_calls: Vec<PostgresRowsQuery>,
}

#[derive(Debug)]
struct FakePostgresGateway {
    connection_info: PostgresConnectionInfo,
    server_version: Option<String>,
    scope_organizations: Vec<AdminScopeOrganizationRecord>,
    scope_organizations_by_ids: Vec<AdminScopeOrganizationRecord>,
    groups: Vec<AdminGroupSummaryRecord>,
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
            scope_organizations: Vec::new(),
            scope_organizations_by_ids: Vec::new(),
            groups: Vec::new(),
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

    fn list_scope_organizations(
        &self,
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganizationRecord>, DataAccessError>> {
        lock_or_recover(&self.calls).list_scope_organizations_calls += 1;
        let result = self.scope_organizations.clone();
        Box::pin(async move { Ok(result) })
    }

    fn list_scope_organizations_by_ids(
        &self,
        organization_ids: &[String],
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganizationRecord>, DataAccessError>> {
        lock_or_recover(&self.calls)
            .list_scope_organizations_by_ids_calls
            .push(organization_ids.to_vec());
        let result = self.scope_organizations_by_ids.clone();
        Box::pin(async move { Ok(result) })
    }

    fn list_groups(
        &self,
        _organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Vec<AdminGroupSummaryRecord>, DataAccessError>> {
        let result = self.groups.clone();
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

    fn get_group(
        &self,
        _group_id: &str,
    ) -> BoxFuture<'_, Result<AdminGroupDetailRecord, DataAccessError>> {
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "not implemented in fake",
            ))
        })
    }

    fn create_group(
        &self,
        _input: tearleads_data_access_traits::AdminCreateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetailRecord, DataAccessError>> {
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "not implemented in fake",
            ))
        })
    }

    fn update_group(
        &self,
        _group_id: &str,
        _input: tearleads_data_access_traits::AdminUpdateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetailRecord, DataAccessError>> {
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "not implemented in fake",
            ))
        })
    }

    fn delete_group(&self, _group_id: &str) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        Box::pin(async move { Ok(true) })
    }

    fn add_group_member(
        &self,
        _group_id: &str,
        _user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        Box::pin(async move { Ok(true) })
    }

    fn remove_group_member(
        &self,
        _group_id: &str,
        _user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        Box::pin(async move { Ok(true) })
    }

    fn list_organizations(
        &self,
        _organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationRecord>, DataAccessError>> {
        Box::pin(async move { Ok(Vec::new()) })
    }

    fn create_organization(
        &self,
        _input: tearleads_data_access_traits::AdminCreateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationRecord, DataAccessError>> {
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "not implemented in fake",
            ))
        })
    }

    fn update_organization(
        &self,
        _organization_id: &str,
        _input: tearleads_data_access_traits::AdminUpdateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationRecord, DataAccessError>> {
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "not implemented in fake",
            ))
        })
    }

    fn delete_organization(
        &self,
        _organization_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        Box::pin(async move { Ok(true) })
    }

    fn get_organization_users(
        &self,
        _organization_id: &str,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationUserRecord>, DataAccessError>> {
        Box::pin(async move { Ok(Vec::new()) })
    }

    fn list_users(
        &self,
        _organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Vec<AdminUserRecord>, DataAccessError>> {
        Box::pin(async move { Ok(Vec::new()) })
    }

    fn get_user(
        &self,
        _user_id: &str,
        _organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Option<AdminUserRecord>, DataAccessError>> {
        Box::pin(async move { Ok(None) })
    }

    fn update_user(
        &self,
        _user_id: &str,
        _input: tearleads_data_access_traits::AdminUpdateUserInput,
    ) -> BoxFuture<'_, Result<AdminUserRecord, DataAccessError>> {
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "not implemented in fake",
            ))
        })
    }
}

#[derive(Debug, Default)]
struct RedisGatewayCalls {
    scan_calls: Vec<(String, u32)>,
    read_key_calls: Vec<String>,
    delete_key_calls: Vec<String>,
    db_size_calls: usize,
}

#[derive(Debug)]
struct FakeRedisGateway {
    scan_result: RedisScanResult,
    read_result: RedisKeyRecord,
    delete_key_result: bool,
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
            delete_key_result: false,
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

    fn delete_key(&self, key: &str) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        lock_or_recover(&self.calls)
            .delete_key_calls
            .push(key.to_string());
        let result = self.delete_key_result;
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
    request.metadata_mut().insert(
        "x-tearleads-admin-scope",
        MetadataValue::from_static("root"),
    );
    request
}

fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

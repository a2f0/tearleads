use std::sync::{Arc, Mutex, MutexGuard};

use tearleads_api_v2::{
    AdminAccessContext, AdminAuthError, AdminAuthErrorKind, AdminOperation, AdminRequestAuthorizer,
};
use tearleads_data_access_traits::{
    AdminGroupSummary, AdminScopeOrganization, BoxFuture, DataAccessError,
    PostgresAdminReadRepository, PostgresColumnInfo, PostgresInfoSnapshot, PostgresRowsPage,
    PostgresRowsQuery, PostgresTableInfo, RedisAdminRepository, RedisKeyScanPage,
    RedisKeyValueRecord,
};
use tonic::{Response, Status};

#[derive(Debug, Clone)]
pub(crate) struct FakeAuthorizer {
    outcome: Result<AdminAccessContext, AdminAuthError>,
    pub(crate) calls: Arc<Mutex<Vec<AdminOperation>>>,
}

impl FakeAuthorizer {
    pub(crate) fn allow_all() -> Self {
        Self {
            outcome: Ok(AdminAccessContext::root()),
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    #[allow(dead_code)]
    pub(crate) fn allow_scoped(organization_ids: Vec<String>) -> Self {
        Self {
            outcome: Ok(AdminAccessContext::scoped(organization_ids)),
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    #[allow(dead_code)]
    pub(crate) fn deny(kind: AdminAuthErrorKind, message: &str) -> Self {
        Self {
            outcome: Err(AdminAuthError::new(kind, message)),
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl AdminRequestAuthorizer for FakeAuthorizer {
    fn authorize_admin_operation(
        &self,
        operation: AdminOperation,
        _metadata: &tonic::metadata::MetadataMap,
    ) -> Result<AdminAccessContext, AdminAuthError> {
        lock_or_recover(&self.calls).push(operation);
        self.outcome.clone()
    }
}

type ListGroupsCall = Option<Vec<String>>;
type ListGroupsCalls = Arc<Mutex<Vec<ListGroupsCall>>>;

#[derive(Debug)]
pub(crate) struct FakePostgresRepository {
    pub(crate) info_result: Result<PostgresInfoSnapshot, DataAccessError>,
    pub(crate) scope_organizations_result: Result<Vec<AdminScopeOrganization>, DataAccessError>,
    pub(crate) scope_organizations_by_ids_result:
        Result<Vec<AdminScopeOrganization>, DataAccessError>,
    pub(crate) scope_organizations_by_ids_calls: Arc<Mutex<Vec<Vec<String>>>>,
    pub(crate) list_groups_result: Result<Vec<AdminGroupSummary>, DataAccessError>,
    pub(crate) list_groups_calls: ListGroupsCalls,
    pub(crate) tables_result: Result<Vec<PostgresTableInfo>, DataAccessError>,
    pub(crate) columns_result: Result<Vec<PostgresColumnInfo>, DataAccessError>,
    pub(crate) columns_calls: Arc<Mutex<Vec<(String, String)>>>,
    pub(crate) rows_result: Result<PostgresRowsPage, DataAccessError>,
    pub(crate) rows_calls: Arc<Mutex<Vec<PostgresRowsQuery>>>,
}

impl Default for FakePostgresRepository {
    fn default() -> Self {
        Self {
            info_result: Ok(PostgresInfoSnapshot::default()),
            scope_organizations_result: Ok(Vec::new()),
            scope_organizations_by_ids_result: Ok(Vec::new()),
            scope_organizations_by_ids_calls: Arc::new(Mutex::new(Vec::new())),
            list_groups_result: Ok(Vec::new()),
            list_groups_calls: Arc::new(Mutex::new(Vec::new())),
            tables_result: Ok(Vec::new()),
            columns_result: Ok(Vec::new()),
            columns_calls: Arc::new(Mutex::new(Vec::new())),
            rows_result: Ok(PostgresRowsPage {
                rows_json: Vec::new(),
                total_count: 0,
                limit: 0,
                offset: 0,
            }),
            rows_calls: Arc::new(Mutex::new(Vec::new())),
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
        organization_ids: Vec<String>,
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganization>, DataAccessError>> {
        lock_or_recover(&self.scope_organizations_by_ids_calls).push(organization_ids);
        let result = self.scope_organizations_by_ids_result.clone();
        Box::pin(async move { result })
    }

    fn list_groups(
        &self,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminGroupSummary>, DataAccessError>> {
        lock_or_recover(&self.list_groups_calls).push(organization_ids);
        let result = self.list_groups_result.clone();
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

    fn list_rows(
        &self,
        query: PostgresRowsQuery,
    ) -> BoxFuture<'_, Result<PostgresRowsPage, DataAccessError>> {
        lock_or_recover(&self.rows_calls).push(query);
        let result = self.rows_result.clone();
        Box::pin(async move { result })
    }
}

#[derive(Debug)]
pub(crate) struct FakeRedisRepository {
    pub(crate) list_keys_result: Result<RedisKeyScanPage, DataAccessError>,
    pub(crate) get_value_result: Result<RedisKeyValueRecord, DataAccessError>,
    pub(crate) delete_key_result: Result<bool, DataAccessError>,
    pub(crate) list_keys_calls: Arc<Mutex<Vec<(String, u32)>>>,
    pub(crate) get_value_calls: Arc<Mutex<Vec<String>>>,
    pub(crate) delete_key_calls: Arc<Mutex<Vec<String>>>,
    pub(crate) db_size_result: Result<u64, DataAccessError>,
    pub(crate) db_size_calls: Arc<Mutex<usize>>,
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
            list_keys_calls: Arc::new(Mutex::new(Vec::new())),
            get_value_calls: Arc::new(Mutex::new(Vec::new())),
            delete_key_calls: Arc::new(Mutex::new(Vec::new())),
            db_size_result: Ok(0),
            db_size_calls: Arc::new(Mutex::new(0)),
        }
    }
}

impl RedisAdminRepository for FakeRedisRepository {
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

    fn delete_key(&self, key: &str) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        lock_or_recover(&self.delete_key_calls).push(key.to_string());
        let result = self.delete_key_result.clone();
        Box::pin(async move { result })
    }

    fn get_db_size(&self) -> BoxFuture<'_, Result<u64, DataAccessError>> {
        *lock_or_recover(&self.db_size_calls) += 1;
        let result = self.db_size_result.clone();
        Box::pin(async move { result })
    }
}

pub(crate) fn into_inner_or_panic<T>(result: Result<Response<T>, Status>) -> T {
    match result {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("unexpected status: {error}"),
    }
}

pub(crate) fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

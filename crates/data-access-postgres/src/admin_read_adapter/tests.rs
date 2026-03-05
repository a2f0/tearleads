use std::sync::{Mutex, MutexGuard};

use futures::executor::block_on;
use tearleads_data_access_traits::{
    AdminGroupSummary, AdminScopeOrganization, BoxFuture, DataAccessError, DataAccessErrorKind,
    PostgresAdminReadRepository, PostgresConnectionInfo, PostgresRowsQuery, PostgresTableInfo,
};

use super::PostgresAdminReadAdapter;
use crate::{
    AdminGroupSummaryRecord, AdminScopeOrganizationRecord, AdminUserAccountingRecord,
    AdminUserRecord, PostgresAdminGateway, PostgresColumnRecord, PostgresRowsPageRecord,
    PostgresTableRecord,
};

#[derive(Debug)]
struct FakeGateway {
    connection_info: PostgresConnectionInfo,
    server_version_result: Result<Option<String>, DataAccessError>,
    scope_organizations_result: Result<Vec<AdminScopeOrganizationRecord>, DataAccessError>,
    scoped_organizations_by_ids_result: Result<Vec<AdminScopeOrganizationRecord>, DataAccessError>,
    groups_result: Result<Vec<AdminGroupSummaryRecord>, DataAccessError>,
    get_user_result: Result<Option<AdminUserRecord>, DataAccessError>,
    tables_result: Result<Vec<PostgresTableRecord>, DataAccessError>,
    table_exists_result: Result<bool, DataAccessError>,
    columns_result: Result<Vec<PostgresColumnRecord>, DataAccessError>,
    rows_result: Result<PostgresRowsPageRecord, DataAccessError>,
    table_exists_calls: Mutex<Vec<(String, String)>>,
    list_scope_organizations_calls: Mutex<usize>,
    list_scope_organizations_by_ids_calls: Mutex<Vec<Vec<String>>>,
    list_groups_calls: Mutex<Vec<Option<Vec<String>>>>,
    get_user_calls: Mutex<Vec<(String, Option<Vec<String>>)>>,
    list_columns_calls: Mutex<Vec<(String, String)>>,
    list_rows_calls: Mutex<Vec<PostgresRowsQuery>>,
}

impl Default for FakeGateway {
    fn default() -> Self {
        Self {
            connection_info: PostgresConnectionInfo::default(),
            server_version_result: Ok(None),
            scope_organizations_result: Ok(Vec::new()),
            scoped_organizations_by_ids_result: Ok(Vec::new()),
            groups_result: Ok(Vec::new()),
            get_user_result: Ok(None),
            tables_result: Ok(Vec::new()),
            table_exists_result: Ok(true),
            columns_result: Ok(Vec::new()),
            rows_result: Ok(PostgresRowsPageRecord {
                rows_json: Vec::new(),
                total_count: 0,
                limit: 0,
                offset: 0,
            }),
            table_exists_calls: Mutex::new(Vec::new()),
            list_scope_organizations_calls: Mutex::new(0),
            list_scope_organizations_by_ids_calls: Mutex::new(Vec::new()),
            list_groups_calls: Mutex::new(Vec::new()),
            get_user_calls: Mutex::new(Vec::new()),
            list_columns_calls: Mutex::new(Vec::new()),
            list_rows_calls: Mutex::new(Vec::new()),
        }
    }
}

impl FakeGateway {
    fn table_exists_calls(&self) -> Vec<(String, String)> {
        lock_or_recover(&self.table_exists_calls).clone()
    }

    fn list_columns_calls(&self) -> Vec<(String, String)> {
        lock_or_recover(&self.list_columns_calls).clone()
    }

    fn list_rows_calls(&self) -> Vec<PostgresRowsQuery> {
        lock_or_recover(&self.list_rows_calls).clone()
    }

    fn list_scope_organizations_calls(&self) -> usize {
        *lock_or_recover(&self.list_scope_organizations_calls)
    }

    fn list_scope_organizations_by_ids_calls(&self) -> Vec<Vec<String>> {
        lock_or_recover(&self.list_scope_organizations_by_ids_calls).clone()
    }

    fn list_groups_calls(&self) -> Vec<Option<Vec<String>>> {
        lock_or_recover(&self.list_groups_calls).clone()
    }

    fn get_user_calls(&self) -> Vec<(String, Option<Vec<String>>)> {
        lock_or_recover(&self.get_user_calls).clone()
    }
}

impl PostgresAdminGateway for FakeGateway {
    fn connection_info(&self) -> PostgresConnectionInfo {
        self.connection_info.clone()
    }

    fn fetch_server_version(&self) -> BoxFuture<'_, Result<Option<String>, DataAccessError>> {
        let result = self.server_version_result.clone();
        Box::pin(async move { result })
    }

    fn list_tables(&self) -> BoxFuture<'_, Result<Vec<PostgresTableRecord>, DataAccessError>> {
        let result = self.tables_result.clone();
        Box::pin(async move { result })
    }

    fn list_scope_organizations(
        &self,
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganizationRecord>, DataAccessError>> {
        *lock_or_recover(&self.list_scope_organizations_calls) += 1;
        let result = self.scope_organizations_result.clone();
        Box::pin(async move { result })
    }

    fn list_scope_organizations_by_ids(
        &self,
        organization_ids: &[String],
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganizationRecord>, DataAccessError>> {
        lock_or_recover(&self.list_scope_organizations_by_ids_calls)
            .push(organization_ids.to_vec());
        let result = self.scoped_organizations_by_ids_result.clone();
        Box::pin(async move { result })
    }

    fn list_groups(
        &self,
        organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Vec<AdminGroupSummaryRecord>, DataAccessError>> {
        lock_or_recover(&self.list_groups_calls).push(organization_ids.map(<[String]>::to_vec));
        let result = self.groups_result.clone();
        Box::pin(async move { result })
    }

    fn get_user(
        &self,
        user_id: &str,
        organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Option<AdminUserRecord>, DataAccessError>> {
        lock_or_recover(&self.get_user_calls).push((
            user_id.to_string(),
            organization_ids.map(<[String]>::to_vec),
        ));
        let result = self.get_user_result.clone();
        Box::pin(async move { result })
    }

    fn table_exists(
        &self,
        schema: &str,
        table: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        lock_or_recover(&self.table_exists_calls).push((schema.to_string(), table.to_string()));
        let result = self.table_exists_result.clone();
        Box::pin(async move { result })
    }

    fn list_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> BoxFuture<'_, Result<Vec<PostgresColumnRecord>, DataAccessError>> {
        lock_or_recover(&self.list_columns_calls).push((schema.to_string(), table.to_string()));
        let result = self.columns_result.clone();
        Box::pin(async move { result })
    }

    fn list_rows(
        &self,
        query: &PostgresRowsQuery,
    ) -> BoxFuture<'_, Result<PostgresRowsPageRecord, DataAccessError>> {
        lock_or_recover(&self.list_rows_calls).push(query.clone());
        let result = self.rows_result.clone();
        Box::pin(async move { result })
    }
}

#[test]
fn postgres_info_uses_gateway_connection_and_version() {
    let gateway = FakeGateway {
        connection_info: PostgresConnectionInfo {
            host: Some(String::from("localhost")),
            port: Some(5432),
            database: Some(String::from("tearleads")),
            user: Some(String::from("tearleads")),
        },
        server_version_result: Ok(Some(String::from("PostgreSQL 16.3"))),
        ..Default::default()
    };

    let adapter = PostgresAdminReadAdapter::new(gateway);
    let result = block_on(adapter.get_postgres_info());
    let snapshot = match result {
        Ok(value) => value,
        Err(error) => panic!("postgres info should succeed, got: {error}"),
    };

    assert_eq!(snapshot.connection.host.as_deref(), Some("localhost"));
    assert_eq!(snapshot.connection.port, Some(5432));
    assert_eq!(snapshot.connection.database.as_deref(), Some("tearleads"));
    assert_eq!(snapshot.connection.user.as_deref(), Some("tearleads"));
    assert_eq!(snapshot.server_version.as_deref(), Some("PostgreSQL 16.3"));
}

#[test]
fn list_tables_maps_gateway_rows() {
    let gateway = FakeGateway {
        tables_result: Ok(vec![PostgresTableRecord {
            schema: String::from("public"),
            name: String::from("users"),
            row_count: 10,
            total_bytes: 2048,
            table_bytes: 1024,
            index_bytes: 1024,
        }]),
        ..Default::default()
    };

    let adapter = PostgresAdminReadAdapter::new(gateway);
    let result = block_on(adapter.list_tables());
    let tables = match result {
        Ok(value) => value,
        Err(error) => panic!("table listing should succeed, got: {error}"),
    };

    assert_eq!(
        tables,
        vec![PostgresTableInfo {
            schema: String::from("public"),
            name: String::from("users"),
            row_count: 10,
            total_bytes: 2048,
            table_bytes: 1024,
            index_bytes: 1024,
        }]
    );
}

#[test]
fn list_scope_organizations_maps_gateway_rows() {
    let gateway = FakeGateway {
        scope_organizations_result: Ok(vec![AdminScopeOrganizationRecord {
            id: String::from("org-1"),
            name: String::from("Alpha"),
        }]),
        ..Default::default()
    };

    let adapter = PostgresAdminReadAdapter::new(gateway);
    let result = block_on(adapter.list_scope_organizations());
    let organizations = match result {
        Ok(value) => value,
        Err(error) => panic!("scope organization listing should succeed, got: {error}"),
    };

    assert_eq!(
        organizations,
        vec![AdminScopeOrganization {
            id: String::from("org-1"),
            name: String::from("Alpha"),
        }]
    );
    assert_eq!(adapter.gateway.list_scope_organizations_calls(), 1);
}

#[test]
fn list_scope_organizations_by_ids_forwards_ids_and_maps_gateway_rows() {
    let gateway = FakeGateway {
        scoped_organizations_by_ids_result: Ok(vec![AdminScopeOrganizationRecord {
            id: String::from("org-2"),
            name: String::from("Beta"),
        }]),
        ..Default::default()
    };
    let adapter = PostgresAdminReadAdapter::new(gateway);

    let result = block_on(
        adapter.list_scope_organizations_by_ids(vec![String::from("org-2"), String::from("org-1")]),
    );
    let organizations = match result {
        Ok(value) => value,
        Err(error) => panic!("scoped organization listing should succeed, got: {error}"),
    };

    assert_eq!(
        organizations,
        vec![AdminScopeOrganization {
            id: String::from("org-2"),
            name: String::from("Beta"),
        }]
    );
    assert_eq!(
        adapter.gateway.list_scope_organizations_by_ids_calls(),
        vec![vec![String::from("org-2"), String::from("org-1")]]
    );
}

#[test]
fn list_groups_forwards_optional_filters_and_maps_gateway_rows() {
    let gateway = FakeGateway {
        groups_result: Ok(vec![AdminGroupSummaryRecord {
            id: String::from("group-1"),
            organization_id: String::from("org-2"),
            name: String::from("Ops"),
            description: Some(String::from("Operators")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-02T00:00:00Z"),
            member_count: 3,
        }]),
        ..Default::default()
    };
    let adapter = PostgresAdminReadAdapter::new(gateway);

    let filtered_result = block_on(adapter.list_groups(Some(vec![String::from("org-2")])));
    let filtered_groups = match filtered_result {
        Ok(value) => value,
        Err(error) => panic!("filtered list_groups should succeed, got: {error}"),
    };
    assert_eq!(
        filtered_groups,
        vec![AdminGroupSummary {
            id: String::from("group-1"),
            organization_id: String::from("org-2"),
            name: String::from("Ops"),
            description: Some(String::from("Operators")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-02T00:00:00Z"),
            member_count: 3,
        }]
    );

    let unfiltered_result = block_on(adapter.list_groups(None));
    if let Err(error) = unfiltered_result {
        panic!("unfiltered list_groups should succeed, got: {error}");
    }

    assert_eq!(
        adapter.gateway.list_groups_calls(),
        vec![Some(vec![String::from("org-2")]), None]
    );
}

#[test]
fn list_columns_forwards_identifiers_to_gateway_calls() {
    let gateway = FakeGateway::default();
    let adapter = PostgresAdminReadAdapter::new(gateway);

    let result = block_on(adapter.list_columns(" public ", " users "));
    if let Err(error) = result {
        panic!("column listing should succeed, got: {error}");
    }

    assert_eq!(
        adapter.gateway.table_exists_calls(),
        vec![(String::from(" public "), String::from(" users "))]
    );
    assert_eq!(
        adapter.gateway.list_columns_calls(),
        vec![(String::from(" public "), String::from(" users "))]
    );
}

#[test]
fn list_columns_returns_not_found_when_table_is_absent() {
    let gateway = FakeGateway {
        table_exists_result: Ok(false),
        ..Default::default()
    };
    let adapter = PostgresAdminReadAdapter::new(gateway);

    let result = block_on(adapter.list_columns("public", "users"));
    let error = match result {
        Ok(_) => panic!("missing table must return a not-found error"),
        Err(error) => error,
    };

    assert_eq!(error.kind(), DataAccessErrorKind::NotFound);
    assert_eq!(error.message(), "table not found: public.users");
}

#[test]
fn list_columns_propagates_gateway_errors() {
    let unavailable = DataAccessError::new(DataAccessErrorKind::Unavailable, "postgres down");
    let gateway = FakeGateway {
        table_exists_result: Err(unavailable.clone()),
        ..Default::default()
    };
    let adapter = PostgresAdminReadAdapter::new(gateway);

    let result = block_on(adapter.list_columns("public", "users"));
    let error = match result {
        Ok(_) => panic!("gateway error should bubble up"),
        Err(error) => error,
    };

    assert_eq!(error, unavailable);
}

#[test]
fn list_rows_forwards_query_before_gateway_calls() {
    let gateway = FakeGateway {
        rows_result: Ok(PostgresRowsPageRecord {
            rows_json: vec![String::from("{\"id\":\"user-1\"}")],
            total_count: 1,
            limit: 10,
            offset: 20,
        }),
        ..Default::default()
    };
    let adapter = PostgresAdminReadAdapter::new(gateway);

    let result = block_on(adapter.list_rows(PostgresRowsQuery {
        schema: String::from(" public "),
        table: String::from(" users "),
        limit: 10,
        offset: 20,
        sort_column: Some(String::from(" id ")),
        sort_direction: Some(String::from("DESC")),
    }));
    let page = match result {
        Ok(value) => value,
        Err(error) => panic!("row listing should succeed, got: {error}"),
    };

    assert_eq!(page.rows_json, vec![String::from("{\"id\":\"user-1\"}")]);
    assert_eq!(page.total_count, 1);
    assert_eq!(page.limit, 10);
    assert_eq!(page.offset, 20);

    assert_eq!(
        adapter.gateway.list_rows_calls(),
        vec![PostgresRowsQuery {
            schema: String::from(" public "),
            table: String::from(" users "),
            limit: 10,
            offset: 20,
            sort_column: Some(String::from(" id ")),
            sort_direction: Some(String::from("DESC")),
        }]
    );
}

#[test]
fn list_rows_forwards_invalid_sort_direction() {
    let gateway = FakeGateway::default();
    let adapter = PostgresAdminReadAdapter::new(gateway);

    let result = block_on(adapter.list_rows(PostgresRowsQuery {
        schema: String::from("public"),
        table: String::from("users"),
        limit: 10,
        offset: 0,
        sort_column: Some(String::from("id")),
        sort_direction: Some(String::from("sideways")),
    }));
    if let Err(error) = result {
        panic!("adapter should forward sort direction without revalidating: {error}");
    }

    assert_eq!(
        adapter.gateway.list_rows_calls(),
        vec![PostgresRowsQuery {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 10,
            offset: 0,
            sort_column: Some(String::from("id")),
            sort_direction: Some(String::from("sideways")),
        }]
    );
}

mod get_user_tests;

fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

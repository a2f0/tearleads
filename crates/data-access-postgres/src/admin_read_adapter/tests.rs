use std::sync::{Mutex, MutexGuard};

use futures::executor::block_on;
use tearleads_data_access_traits::{
    BoxFuture, DataAccessError, DataAccessErrorKind, PostgresAdminReadRepository,
    PostgresConnectionInfo, PostgresRowsQuery, PostgresTableInfo,
};

use super::PostgresAdminReadAdapter;
use crate::{
    PostgresAdminGateway, PostgresColumnRecord, PostgresRowsPageRecord, PostgresTableRecord,
};

#[derive(Debug)]
struct FakeGateway {
    connection_info: PostgresConnectionInfo,
    server_version_result: Result<Option<String>, DataAccessError>,
    tables_result: Result<Vec<PostgresTableRecord>, DataAccessError>,
    table_exists_result: Result<bool, DataAccessError>,
    columns_result: Result<Vec<PostgresColumnRecord>, DataAccessError>,
    rows_result: Result<PostgresRowsPageRecord, DataAccessError>,
    table_exists_calls: Mutex<Vec<(String, String)>>,
    list_columns_calls: Mutex<Vec<(String, String)>>,
    list_rows_calls: Mutex<Vec<PostgresRowsQuery>>,
}

impl Default for FakeGateway {
    fn default() -> Self {
        Self {
            connection_info: PostgresConnectionInfo::default(),
            server_version_result: Ok(None),
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
fn list_columns_normalizes_identifiers_for_gateway_calls() {
    let gateway = FakeGateway::default();
    let adapter = PostgresAdminReadAdapter::new(gateway);

    let result = block_on(adapter.list_columns(" public ", " users "));
    if let Err(error) = result {
        panic!("column listing should succeed, got: {error}");
    }

    assert_eq!(
        adapter.gateway.table_exists_calls(),
        vec![(String::from("public"), String::from("users"))]
    );
    assert_eq!(
        adapter.gateway.list_columns_calls(),
        vec![(String::from("public"), String::from("users"))]
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
fn list_columns_rejects_unsafe_identifier_before_gateway_io() {
    let gateway = FakeGateway::default();
    let adapter = PostgresAdminReadAdapter::new(gateway);

    let result = block_on(adapter.list_columns("public;drop", "users"));
    let error = match result {
        Ok(_) => panic!("unsafe identifiers must fail validation"),
        Err(error) => error,
    };

    assert_eq!(error.kind(), DataAccessErrorKind::InvalidInput);
    assert!(
        error
            .message()
            .contains("identifier must contain only ASCII letters"),
        "validation message should explain allowed characters"
    );
    assert!(adapter.gateway.table_exists_calls().is_empty());
    assert!(adapter.gateway.list_columns_calls().is_empty());
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
fn list_rows_normalizes_query_before_gateway_calls() {
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
            schema: String::from("public"),
            table: String::from("users"),
            limit: 10,
            offset: 20,
            sort_column: Some(String::from("id")),
            sort_direction: Some(String::from("desc")),
        }]
    );
}

#[test]
fn list_rows_rejects_invalid_sort_direction() {
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
    let error = match result {
        Ok(_) => panic!("invalid sort direction must fail validation"),
        Err(error) => error,
    };

    assert_eq!(error.kind(), DataAccessErrorKind::InvalidInput);
    assert_eq!(error.message(), "sortDirection must be \"asc\" or \"desc\"");
    assert!(adapter.gateway.list_rows_calls().is_empty());
}

fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

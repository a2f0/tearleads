//! Adapter that maps gateway records to shared Postgres admin read models.

use tearleads_api_domain_core::normalize_sql_identifier;
use tearleads_data_access_traits::{
    BoxFuture, DataAccessError, DataAccessErrorKind, PostgresAdminReadRepository,
    PostgresColumnInfo, PostgresInfoSnapshot, PostgresTableInfo,
};

use crate::PostgresAdminGateway;

/// Postgres repository implementation over a driver-specific gateway.
pub struct PostgresAdminReadAdapter<G> {
    gateway: G,
}

impl<G> PostgresAdminReadAdapter<G> {
    /// Builds an adapter around a gateway implementation.
    pub fn new(gateway: G) -> Self {
        Self { gateway }
    }
}

impl<G> PostgresAdminReadRepository for PostgresAdminReadAdapter<G>
where
    G: PostgresAdminGateway + Send + Sync,
{
    fn get_postgres_info(&self) -> BoxFuture<'_, Result<PostgresInfoSnapshot, DataAccessError>> {
        Box::pin(async move {
            let server_version = self.gateway.fetch_server_version().await?;
            Ok(PostgresInfoSnapshot {
                connection: self.gateway.connection_info(),
                server_version,
            })
        })
    }

    fn list_tables(&self) -> BoxFuture<'_, Result<Vec<PostgresTableInfo>, DataAccessError>> {
        Box::pin(async move {
            let records = self.gateway.list_tables().await?;
            let tables = records
                .into_iter()
                .map(|record| PostgresTableInfo {
                    schema: record.schema,
                    name: record.name,
                    row_count: record.row_count,
                    total_bytes: record.total_bytes,
                    table_bytes: record.table_bytes,
                    index_bytes: record.index_bytes,
                })
                .collect();
            Ok(tables)
        })
    }

    fn list_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> BoxFuture<'_, Result<Vec<PostgresColumnInfo>, DataAccessError>> {
        let normalized_schema = match normalize_identifier("schema", schema) {
            Ok(value) => value,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        let normalized_table = match normalize_identifier("table", table) {
            Ok(value) => value,
            Err(error) => return Box::pin(async move { Err(error) }),
        };

        Box::pin(async move {
            let exists = self
                .gateway
                .table_exists(&normalized_schema, &normalized_table)
                .await?;
            if !exists {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::NotFound,
                    format!("table not found: {normalized_schema}.{normalized_table}"),
                ));
            }

            let records = self
                .gateway
                .list_columns(&normalized_schema, &normalized_table)
                .await?;
            let columns = records
                .into_iter()
                .map(|record| PostgresColumnInfo {
                    name: record.name,
                    data_type: record.data_type,
                    nullable: record.nullable,
                    default_value: record.default_value,
                    ordinal_position: record.ordinal_position,
                })
                .collect();
            Ok(columns)
        })
    }
}

fn normalize_identifier(field: &'static str, value: &str) -> Result<String, DataAccessError> {
    match normalize_sql_identifier(field, value) {
        Ok(identifier) => Ok(identifier),
        Err(error) => Err(DataAccessError::new(
            DataAccessErrorKind::InvalidInput,
            error.to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Mutex, MutexGuard};

    use futures::executor::block_on;
    use tearleads_data_access_traits::{
        BoxFuture, DataAccessError, DataAccessErrorKind, PostgresAdminReadRepository,
        PostgresConnectionInfo, PostgresTableInfo,
    };

    use super::PostgresAdminReadAdapter;
    use crate::{PostgresAdminGateway, PostgresColumnRecord, PostgresTableRecord};

    #[derive(Debug)]
    struct FakeGateway {
        connection_info: PostgresConnectionInfo,
        server_version_result: Result<Option<String>, DataAccessError>,
        tables_result: Result<Vec<PostgresTableRecord>, DataAccessError>,
        table_exists_result: Result<bool, DataAccessError>,
        columns_result: Result<Vec<PostgresColumnRecord>, DataAccessError>,
        table_exists_calls: Mutex<Vec<(String, String)>>,
        list_columns_calls: Mutex<Vec<(String, String)>>,
    }

    impl Default for FakeGateway {
        fn default() -> Self {
            Self {
                connection_info: PostgresConnectionInfo::default(),
                server_version_result: Ok(None),
                tables_result: Ok(Vec::new()),
                table_exists_result: Ok(true),
                columns_result: Ok(Vec::new()),
                table_exists_calls: Mutex::new(Vec::new()),
                list_columns_calls: Mutex::new(Vec::new()),
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

    fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        match mutex.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

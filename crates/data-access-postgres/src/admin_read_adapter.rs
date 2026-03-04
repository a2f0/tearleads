//! Adapter that maps gateway records to shared Postgres admin read models.

use tearleads_api_domain_core::normalize_sql_identifier;
use tearleads_data_access_traits::{
    BoxFuture, DataAccessError, DataAccessErrorKind, PostgresAdminReadRepository,
    PostgresColumnInfo, PostgresInfoSnapshot, PostgresRowsPage, PostgresRowsQuery,
    PostgresTableInfo,
};

use crate::{PostgresAdminGateway, PostgresRowsPageRecord};

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

    fn list_rows(
        &self,
        query: PostgresRowsQuery,
    ) -> BoxFuture<'_, Result<PostgresRowsPage, DataAccessError>> {
        let PostgresRowsQuery {
            schema,
            table,
            limit,
            offset,
            sort_column,
            sort_direction,
        } = query;

        let normalized_schema = match normalize_identifier("schema", &schema) {
            Ok(value) => value,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        let normalized_table = match normalize_identifier("table", &table) {
            Ok(value) => value,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        let normalized_sort_column = match sort_column {
            Some(sort_column) => match normalize_identifier("sortColumn", &sort_column) {
                Ok(value) => Some(value),
                Err(error) => return Box::pin(async move { Err(error) }),
            },
            None => None,
        };
        let normalized_sort_direction = match normalize_sort_direction(sort_direction) {
            Ok(value) => value,
            Err(error) => return Box::pin(async move { Err(error) }),
        };

        let normalized_query = PostgresRowsQuery {
            schema: normalized_schema,
            table: normalized_table,
            limit,
            offset,
            sort_column: normalized_sort_column,
            sort_direction: normalized_sort_direction,
        };

        Box::pin(async move {
            let page = self.gateway.list_rows(&normalized_query).await?;
            Ok(map_rows_page(page))
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

fn normalize_sort_direction(value: Option<String>) -> Result<Option<String>, DataAccessError> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    match trimmed {
        "asc" | "ASC" => Ok(Some(String::from("asc"))),
        "desc" | "DESC" => Ok(Some(String::from("desc"))),
        _ => Err(DataAccessError::new(
            DataAccessErrorKind::InvalidInput,
            "sortDirection must be \"asc\" or \"desc\"",
        )),
    }
}

fn map_rows_page(record: PostgresRowsPageRecord) -> PostgresRowsPage {
    PostgresRowsPage {
        rows_json: record.rows_json,
        total_count: record.total_count,
        limit: record.limit,
        offset: record.offset,
    }
}

#[cfg(test)]
mod tests;

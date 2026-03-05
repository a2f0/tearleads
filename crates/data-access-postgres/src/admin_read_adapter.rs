//! Adapter that maps gateway records to shared Postgres admin read models.

use tearleads_data_access_traits::{
    AdminScopeOrganization, BoxFuture, DataAccessError, DataAccessErrorKind,
    PostgresAdminReadRepository, PostgresColumnInfo, PostgresInfoSnapshot, PostgresRowsPage,
    PostgresRowsQuery, PostgresTableInfo,
};

use crate::{AdminScopeOrganizationRecord, PostgresAdminGateway, PostgresRowsPageRecord};

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

    fn list_scope_organizations(
        &self,
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganization>, DataAccessError>> {
        Box::pin(async move {
            let organizations = self.gateway.list_scope_organizations().await?;
            Ok(map_scope_organizations(organizations))
        })
    }

    fn list_scope_organizations_by_ids(
        &self,
        organization_ids: Vec<String>,
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganization>, DataAccessError>> {
        Box::pin(async move {
            let organizations = self
                .gateway
                .list_scope_organizations_by_ids(&organization_ids)
                .await?;
            Ok(map_scope_organizations(organizations))
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
        let schema = schema.to_string();
        let table = table.to_string();

        Box::pin(async move {
            let exists = self.gateway.table_exists(&schema, &table).await?;
            if !exists {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::NotFound,
                    format!("table not found: {schema}.{table}"),
                ));
            }

            let records = self.gateway.list_columns(&schema, &table).await?;
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
        Box::pin(async move {
            let page = self.gateway.list_rows(&query).await?;
            Ok(map_rows_page(page))
        })
    }
}

fn map_scope_organizations(
    records: Vec<AdminScopeOrganizationRecord>,
) -> Vec<AdminScopeOrganization> {
    records
        .into_iter()
        .map(|record| AdminScopeOrganization {
            id: record.id,
            name: record.name,
        })
        .collect()
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

//! Postgres read models and repository boundary traits.

use crate::{BoxFuture, DataAccessError};

/// Connection details suitable for admin diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PostgresConnectionInfo {
    /// Hostname reported by environment/config.
    pub host: Option<String>,
    /// TCP port reported by environment/config.
    pub port: Option<u16>,
    /// Database name reported by environment/config.
    pub database: Option<String>,
    /// Username reported by environment/config.
    pub user: Option<String>,
}

/// Snapshot returned by the Postgres info endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PostgresInfoSnapshot {
    /// Connection metadata from configuration.
    pub connection: PostgresConnectionInfo,
    /// Database server version string when available.
    pub server_version: Option<String>,
}

/// Table metadata exposed by admin inspection endpoints.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostgresTableInfo {
    /// SQL schema name.
    pub schema: String,
    /// SQL table name.
    pub name: String,
    /// Approximate row count.
    pub row_count: i64,
    /// Total relation bytes.
    pub total_bytes: i64,
    /// Heap/table bytes.
    pub table_bytes: i64,
    /// Index bytes.
    pub index_bytes: i64,
}

/// Column metadata exposed by admin inspection endpoints.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostgresColumnInfo {
    /// Column name.
    pub name: String,
    /// SQL data type.
    pub data_type: String,
    /// Whether the column accepts NULL values.
    pub nullable: bool,
    /// Default expression when present.
    pub default_value: Option<String>,
    /// Position of the column in table definition order.
    pub ordinal_position: u32,
}

/// Query options for admin table row browsing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostgresRowsQuery {
    /// SQL schema name.
    pub schema: String,
    /// SQL table name.
    pub table: String,
    /// Page size cap.
    pub limit: u32,
    /// Row offset.
    pub offset: u32,
    /// Optional sort column.
    pub sort_column: Option<String>,
    /// Optional sort direction (`asc` or `desc`).
    pub sort_direction: Option<String>,
}

/// Page payload for admin table row browsing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostgresRowsPage {
    /// JSON-encoded row objects.
    pub rows_json: Vec<String>,
    /// Total table row count.
    pub total_count: u64,
    /// Effective page size.
    pub limit: u32,
    /// Effective row offset.
    pub offset: u32,
}

/// Repository boundary for admin Postgres reads.
pub trait PostgresAdminReadRepository: Send + Sync {
    /// Returns environment + server-version metadata.
    fn get_postgres_info(&self) -> BoxFuture<'_, Result<PostgresInfoSnapshot, DataAccessError>>;

    /// Returns table metadata for the admin browsing surface.
    fn list_tables(&self) -> BoxFuture<'_, Result<Vec<PostgresTableInfo>, DataAccessError>>;

    /// Returns ordered column metadata for one table.
    fn list_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> BoxFuture<'_, Result<Vec<PostgresColumnInfo>, DataAccessError>>;

    /// Returns table rows for one target table.
    fn list_rows(
        &self,
        query: PostgresRowsQuery,
    ) -> BoxFuture<'_, Result<PostgresRowsPage, DataAccessError>>;
}

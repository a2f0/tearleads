//! Driver-facing gateway abstraction for Postgres admin reads.

use tearleads_data_access_traits::{BoxFuture, DataAccessError, PostgresConnectionInfo};

/// Raw table metadata returned by the backing Postgres driver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostgresTableRecord {
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

/// Raw column metadata returned by the backing Postgres driver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostgresColumnRecord {
    /// Column name.
    pub name: String,
    /// SQL data type.
    pub data_type: String,
    /// Whether the column accepts NULL values.
    pub nullable: bool,
    /// Default expression when present.
    pub default_value: Option<String>,
    /// Position in table definition order.
    pub ordinal_position: u32,
}

/// Driver gateway used by [`crate::PostgresAdminReadAdapter`].
pub trait PostgresAdminGateway: Send + Sync {
    /// Returns connection metadata from runtime configuration.
    fn connection_info(&self) -> PostgresConnectionInfo;

    /// Returns the server version string when available.
    fn fetch_server_version(&self) -> BoxFuture<'_, Result<Option<String>, DataAccessError>>;

    /// Lists all tables visible to the admin reader.
    fn list_tables(&self) -> BoxFuture<'_, Result<Vec<PostgresTableRecord>, DataAccessError>>;

    /// Checks whether a target table exists.
    fn table_exists(
        &self,
        schema: &str,
        table: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>>;

    /// Lists column metadata for one target table.
    fn list_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> BoxFuture<'_, Result<Vec<PostgresColumnRecord>, DataAccessError>>;
}

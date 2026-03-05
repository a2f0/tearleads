//! Driver-facing gateway abstraction for Postgres admin reads.

use tearleads_data_access_traits::{
    BoxFuture, DataAccessError, PostgresConnectionInfo, PostgresRowsQuery,
};

/// Raw organization metadata returned by the backing Postgres driver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminScopeOrganizationRecord {
    /// Organization identifier.
    pub id: String,
    /// Display name.
    pub name: String,
}

/// Raw group metadata returned by the backing Postgres driver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminGroupSummaryRecord {
    /// Group identifier.
    pub id: String,
    /// Owning organization identifier.
    pub organization_id: String,
    /// Display name.
    pub name: String,
    /// Optional group description.
    pub description: Option<String>,
    /// RFC3339 creation timestamp.
    pub created_at: String,
    /// RFC3339 update timestamp.
    pub updated_at: String,
    /// Number of members assigned to the group.
    pub member_count: u32,
}

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

/// Raw row page payload returned by the backing Postgres driver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostgresRowsPageRecord {
    /// JSON-encoded row objects.
    pub rows_json: Vec<String>,
    /// Total table row count.
    pub total_count: u64,
    /// Effective page size.
    pub limit: u32,
    /// Effective row offset.
    pub offset: u32,
}

/// Driver gateway used by [`crate::PostgresAdminReadAdapter`].
pub trait PostgresAdminGateway: Send + Sync {
    /// Returns connection metadata from runtime configuration.
    fn connection_info(&self) -> PostgresConnectionInfo;

    /// Returns the server version string when available.
    fn fetch_server_version(&self) -> BoxFuture<'_, Result<Option<String>, DataAccessError>>;

    /// Lists all organizations for root-admin context.
    fn list_scope_organizations(
        &self,
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganizationRecord>, DataAccessError>>;

    /// Lists organizations matching the provided organization IDs.
    fn list_scope_organizations_by_ids(
        &self,
        organization_ids: &[String],
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganizationRecord>, DataAccessError>>;

    /// Lists groups optionally constrained to organization IDs.
    fn list_groups(
        &self,
        organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Vec<AdminGroupSummaryRecord>, DataAccessError>>;

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

    /// Returns one page of table rows for the given query.
    fn list_rows(
        &self,
        query: &PostgresRowsQuery,
    ) -> BoxFuture<'_, Result<PostgresRowsPageRecord, DataAccessError>>;
}

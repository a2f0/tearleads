//! Driver-facing gateway abstraction for Postgres admin reads.

use tearleads_data_access_traits::{
    BoxFuture, DataAccessError, DataAccessErrorKind, PostgresConnectionInfo, PostgresRowsQuery,
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

/// Raw group member metadata returned by the backing Postgres driver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminGroupMemberRecord {
    /// User identifier.
    pub user_id: String,
    /// User email.
    pub email: String,
    /// RFC3339 join timestamp.
    pub joined_at: String,
}

/// Raw group detail payload returned by the backing Postgres driver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminGroupDetailRecord {
    /// Group identifier.
    pub id: String,
    /// Owning organization identifier.
    pub organization_id: String,
    /// Group name.
    pub name: String,
    /// Optional group description.
    pub description: Option<String>,
    /// RFC3339 creation timestamp.
    pub created_at: String,
    /// RFC3339 update timestamp.
    pub updated_at: String,
    /// Group members ordered by join timestamp.
    pub members: Vec<AdminGroupMemberRecord>,
}

/// Raw organization metadata returned by the backing Postgres driver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminOrganizationRecord {
    /// Organization identifier.
    pub id: String,
    /// Organization display name.
    pub name: String,
    /// Optional organization description.
    pub description: Option<String>,
    /// RFC3339 creation timestamp.
    pub created_at: String,
    /// RFC3339 update timestamp.
    pub updated_at: String,
}

/// Raw user accounting metadata returned by the backing Postgres driver.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AdminUserAccountingRecord {
    /// Total prompt tokens consumed.
    pub total_prompt_tokens: u64,
    /// Total completion tokens consumed.
    pub total_completion_tokens: u64,
    /// Total tokens consumed.
    pub total_tokens: u64,
    /// Number of requests recorded.
    pub request_count: u64,
    /// RFC3339 latest-usage timestamp when available.
    pub last_used_at: Option<String>,
}

/// Raw user metadata returned by the backing Postgres driver.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AdminUserRecord {
    /// User identifier.
    pub id: String,
    /// User email.
    pub email: String,
    /// Whether the email has been confirmed.
    pub email_confirmed: bool,
    /// Whether the user is a platform admin.
    pub admin: bool,
    /// Organization identifiers assigned to this user.
    pub organization_ids: Vec<String>,
    /// RFC3339 creation timestamp when available.
    pub created_at: Option<String>,
    /// RFC3339 last-active timestamp when available.
    pub last_active_at: Option<String>,
    /// User accounting snapshot.
    pub accounting: AdminUserAccountingRecord,
    /// Whether this user is disabled.
    pub disabled: bool,
    /// RFC3339 disabled timestamp when available.
    pub disabled_at: Option<String>,
    /// User ID that disabled this account when available.
    pub disabled_by: Option<String>,
    /// RFC3339 deletion-mark timestamp when available.
    pub marked_for_deletion_at: Option<String>,
    /// User ID that marked for deletion when available.
    pub marked_for_deletion_by: Option<String>,
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

    /// Returns one group detail payload by identifier.
    fn get_group(
        &self,
        group_id: &str,
    ) -> BoxFuture<'_, Result<AdminGroupDetailRecord, DataAccessError>> {
        let group_id = group_id.to_string();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!("get_group not implemented for group_id={group_id}"),
            ))
        })
    }

    /// Lists organizations optionally constrained to organization IDs.
    fn list_organizations(
        &self,
        organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationRecord>, DataAccessError>> {
        let filter = organization_ids.map(<[String]>::to_vec).unwrap_or_default();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!("list_organizations not implemented for organization_ids={filter:?}"),
            ))
        })
    }

    /// Lists users optionally constrained to organization IDs.
    fn list_users(
        &self,
        organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Vec<AdminUserRecord>, DataAccessError>> {
        let filter = organization_ids.map(<[String]>::to_vec).unwrap_or_default();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!("list_users not implemented for organization_ids={filter:?}"),
            ))
        })
    }

    /// Returns one user by identifier, optionally constrained to organization IDs.
    fn get_user(
        &self,
        user_id: &str,
        organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Option<AdminUserRecord>, DataAccessError>> {
        let user_id = user_id.to_string();
        let filter = organization_ids.map(<[String]>::to_vec).unwrap_or_default();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!(
                    "get_user not implemented for user_id={user_id} organization_ids={filter:?}"
                ),
            ))
        })
    }

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

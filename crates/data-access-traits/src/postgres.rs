//! Postgres read models and repository boundary traits.

use crate::{BoxFuture, DataAccessError, DataAccessErrorKind};

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

/// Organization details exposed in admin access context responses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminScopeOrganization {
    /// Organization identifier.
    pub id: String,
    /// Display name.
    pub name: String,
}

/// Group metadata exposed by admin group listing endpoints.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminGroupSummary {
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

/// Group member metadata exposed by admin group detail responses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminGroupMember {
    /// User identifier.
    pub user_id: String,
    /// User email.
    pub email: String,
    /// RFC3339 timestamp for when the member joined.
    pub joined_at: String,
}

/// Group detail payload exposed by admin group detail endpoints.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminGroupDetail {
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
    /// Group members ordered by join time.
    pub members: Vec<AdminGroupMember>,
}

/// Organization metadata exposed by admin organization list endpoints.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminOrganizationSummary {
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

/// Organization member metadata exposed by organization user detail endpoints.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminOrganizationUserSummary {
    /// User identifier.
    pub id: String,
    /// User email.
    pub email: String,
    /// RFC3339 timestamp for when the user joined the organization.
    pub joined_at: String,
}

/// Accounting metadata exposed in admin user list responses.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AdminUserAccountingSummary {
    /// Total prompt tokens consumed.
    pub total_prompt_tokens: u64,
    /// Total completion tokens consumed.
    pub total_completion_tokens: u64,
    /// Total tokens consumed.
    pub total_tokens: u64,
    /// Number of requests recorded.
    pub request_count: u64,
    /// RFC3339 timestamp for latest usage when available.
    pub last_used_at: Option<String>,
}

/// User metadata exposed by admin user list endpoints.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AdminUserSummary {
    /// User identifier.
    pub id: String,
    /// User email.
    pub email: String,
    /// Whether the email has been confirmed.
    pub email_confirmed: bool,
    /// Whether the user is a platform admin.
    pub admin: bool,
    /// Organization IDs assigned to the user.
    pub organization_ids: Vec<String>,
    /// RFC3339 creation timestamp when available.
    pub created_at: Option<String>,
    /// RFC3339 last-active timestamp when available.
    pub last_active_at: Option<String>,
    /// User accounting snapshot.
    pub accounting: AdminUserAccountingSummary,
    /// Whether the user is currently disabled.
    pub disabled: bool,
    /// RFC3339 disabled timestamp when available.
    pub disabled_at: Option<String>,
    /// User ID that disabled this account when available.
    pub disabled_by: Option<String>,
    /// RFC3339 deletion-mark timestamp when available.
    pub marked_for_deletion_at: Option<String>,
    /// User ID that marked this account for deletion when available.
    pub marked_for_deletion_by: Option<String>,
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

    /// Returns all organizations for root-admin context.
    fn list_scope_organizations(
        &self,
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganization>, DataAccessError>>;

    /// Returns organizations matching the provided scoped-admin organization IDs.
    fn list_scope_organizations_by_ids(
        &self,
        organization_ids: Vec<String>,
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganization>, DataAccessError>>;

    /// Lists groups, optionally constrained to organization IDs.
    fn list_groups(
        &self,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminGroupSummary>, DataAccessError>>;

    /// Returns one group detail payload by identifier.
    fn get_group(
        &self,
        group_id: &str,
    ) -> BoxFuture<'_, Result<AdminGroupDetail, DataAccessError>> {
        let group_id = group_id.to_string();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!("get_group not implemented for group_id={group_id}"),
            ))
        })
    }

    /// Lists organizations, optionally constrained to organization IDs.
    fn list_organizations(
        &self,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationSummary>, DataAccessError>> {
        let filter = organization_ids.unwrap_or_default();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!("list_organizations not implemented for organization_ids={filter:?}"),
            ))
        })
    }

    /// Lists users for one organization identifier.
    fn get_organization_users(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationUserSummary>, DataAccessError>> {
        let organization_id = organization_id.to_string();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!(
                    "get_organization_users not implemented for organization_id={organization_id}"
                ),
            ))
        })
    }

    /// Lists users, optionally constrained to organization IDs.
    fn list_users(
        &self,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminUserSummary>, DataAccessError>> {
        let filter = organization_ids.unwrap_or_default();
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
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Option<AdminUserSummary>, DataAccessError>> {
        let user_id = user_id.to_string();
        let filter = organization_ids.unwrap_or_default();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!(
                    "get_user not implemented for user_id={user_id} organization_ids={filter:?}"
                ),
            ))
        })
    }

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

//! Postgres read models and repository boundary traits.

mod models;

pub use models::{
    AdminCreateGroupInput, AdminCreateOrganizationInput, AdminGroupDetail, AdminGroupMember,
    AdminGroupSummary, AdminOrganizationSummary, AdminOrganizationUserSummary,
    AdminScopeOrganization, AdminUpdateGroupInput, AdminUpdateOrganizationInput,
    AdminUpdateUserInput, AdminUserAccountingSummary, AdminUserSummary, PostgresColumnInfo,
    PostgresConnectionInfo, PostgresInfoSnapshot, PostgresRowsPage, PostgresRowsQuery,
    PostgresTableInfo,
};

use crate::{BoxFuture, DataAccessError};

/// Repository boundary for admin Postgres access.
pub trait PostgresAdminRepository: Send + Sync {
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
    fn get_group(&self, group_id: &str)
    -> BoxFuture<'_, Result<AdminGroupDetail, DataAccessError>>;

    /// Creates one group and returns the persisted group metadata.
    fn create_group(
        &self,
        input: AdminCreateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetail, DataAccessError>>;

    /// Updates one group and returns the persisted group metadata.
    fn update_group(
        &self,
        group_id: &str,
        input: AdminUpdateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetail, DataAccessError>>;

    /// Deletes one group by identifier and returns whether it was removed.
    fn delete_group(&self, group_id: &str) -> BoxFuture<'_, Result<bool, DataAccessError>>;

    /// Adds one user to a group and returns whether a membership was created.
    fn add_group_member(
        &self,
        group_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>>;

    /// Removes one user from a group and returns whether a membership was removed.
    fn remove_group_member(
        &self,
        group_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>>;

    /// Lists organizations, optionally constrained to organization IDs.
    fn list_organizations(
        &self,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationSummary>, DataAccessError>>;

    /// Creates one organization and returns the persisted metadata.
    fn create_organization(
        &self,
        input: AdminCreateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationSummary, DataAccessError>>;

    /// Updates one organization and returns the persisted metadata.
    fn update_organization(
        &self,
        organization_id: &str,
        input: AdminUpdateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationSummary, DataAccessError>>;

    /// Deletes one organization and returns whether it was removed.
    fn delete_organization(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>>;

    /// Lists users for one organization identifier.
    fn get_organization_users(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationUserSummary>, DataAccessError>>;

    /// Lists users, optionally constrained to organization IDs.
    fn list_users(
        &self,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminUserSummary>, DataAccessError>>;

    /// Returns one user by identifier, optionally constrained to organization IDs.
    fn get_user(
        &self,
        user_id: &str,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Option<AdminUserSummary>, DataAccessError>>;

    /// Updates one user and returns the persisted metadata.
    fn update_user(
        &self,
        user_id: &str,
        input: AdminUpdateUserInput,
    ) -> BoxFuture<'_, Result<AdminUserSummary, DataAccessError>>;

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

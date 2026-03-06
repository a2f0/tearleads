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

use crate::{BoxFuture, DataAccessError, DataAccessErrorKind};

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

    /// Creates one group and returns the persisted group metadata.
    fn create_group(
        &self,
        input: AdminCreateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetail, DataAccessError>> {
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!(
                    "create_group not implemented for organization_id={} name={}",
                    input.organization_id, input.name
                ),
            ))
        })
    }

    /// Updates one group and returns the persisted group metadata.
    fn update_group(
        &self,
        group_id: &str,
        input: AdminUpdateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetail, DataAccessError>> {
        let group_id = group_id.to_string();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!("update_group not implemented for group_id={group_id} input={input:?}"),
            ))
        })
    }

    /// Deletes one group by identifier and returns whether it was removed.
    fn delete_group(&self, group_id: &str) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let group_id = group_id.to_string();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!("delete_group not implemented for group_id={group_id}"),
            ))
        })
    }

    /// Adds one user to a group and returns whether a membership was created.
    fn add_group_member(
        &self,
        group_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let group_id = group_id.to_string();
        let user_id = user_id.to_string();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!(
                    "add_group_member not implemented for group_id={group_id} user_id={user_id}"
                ),
            ))
        })
    }

    /// Removes one user from a group and returns whether a membership was removed.
    fn remove_group_member(
        &self,
        group_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let group_id = group_id.to_string();
        let user_id = user_id.to_string();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!(
                    "remove_group_member not implemented for group_id={group_id} user_id={user_id}"
                ),
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

    /// Creates one organization and returns the persisted metadata.
    fn create_organization(
        &self,
        input: AdminCreateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationSummary, DataAccessError>> {
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!(
                    "create_organization not implemented for name={}",
                    input.name
                ),
            ))
        })
    }

    /// Updates one organization and returns the persisted metadata.
    fn update_organization(
        &self,
        organization_id: &str,
        input: AdminUpdateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationSummary, DataAccessError>> {
        let organization_id = organization_id.to_string();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!(
                    "update_organization not implemented for organization_id={organization_id} input={input:?}"
                ),
            ))
        })
    }

    /// Deletes one organization and returns whether it was removed.
    fn delete_organization(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let organization_id = organization_id.to_string();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!(
                    "delete_organization not implemented for organization_id={organization_id}"
                ),
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

    /// Updates one user and returns the persisted metadata.
    fn update_user(
        &self,
        user_id: &str,
        input: AdminUpdateUserInput,
    ) -> BoxFuture<'_, Result<AdminUserSummary, DataAccessError>> {
        let user_id = user_id.to_string();
        Box::pin(async move {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                format!("update_user not implemented for user_id={user_id} input={input:?}"),
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

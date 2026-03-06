//! Auth policy boundaries for admin RPC handlers.

use tonic::{Status, metadata::MetadataMap};

/// Canonical admin access scope resolved for a request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminAccessContext {
    is_root_admin: bool,
    organization_ids: Vec<String>,
}

impl AdminAccessContext {
    /// Constructs root-admin access context.
    pub fn root() -> Self {
        Self {
            is_root_admin: true,
            organization_ids: Vec::new(),
        }
    }

    /// Constructs scoped-admin access context.
    pub fn scoped(organization_ids: Vec<String>) -> Self {
        Self {
            is_root_admin: false,
            organization_ids,
        }
    }

    /// Returns whether this caller has root-admin permissions.
    pub fn is_root_admin(&self) -> bool {
        self.is_root_admin
    }

    /// Returns organization identifiers available to a scoped admin.
    pub fn organization_ids(&self) -> &[String] {
        &self.organization_ids
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AdminOperationScope {
    RootOnly,
    ScopedOrRoot,
}

/// Supported admin RPC operations requiring authorization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdminOperation {
    /// `AdminService.GetPostgresInfo`
    GetPostgresInfo,
    /// `AdminService.GetTables`
    GetTables,
    /// `AdminService.GetColumns`
    GetColumns,
    /// `AdminService.GetRows`
    GetRows,
    /// `AdminService.GetRedisKeys`
    GetRedisKeys,
    /// `AdminService.GetRedisValue`
    GetRedisValue,
    /// `AdminService.DeleteRedisKey`
    DeleteRedisKey,
    /// `AdminService.GetRedisDbSize`
    GetRedisDbSize,
    /// `AdminService.GetContext`
    GetContext,
    /// `AdminService.ListGroups`
    ListGroups,
    /// `AdminService.GetGroup`
    GetGroup,
    /// `AdminService.CreateGroup`
    CreateGroup,
    /// `AdminService.UpdateGroup`
    UpdateGroup,
    /// `AdminService.DeleteGroup`
    DeleteGroup,
    /// `AdminService.GetGroupMembers`
    GetGroupMembers,
    /// `AdminService.AddGroupMember`
    AddGroupMember,
    /// `AdminService.RemoveGroupMember`
    RemoveGroupMember,
    /// `AdminService.ListOrganizations`
    ListOrganizations,
    /// `AdminService.GetOrganization`
    GetOrganization,
    /// `AdminService.GetOrgUsers`
    GetOrgUsers,
    /// `AdminService.GetOrgGroups`
    GetOrgGroups,
    /// `AdminService.ListUsers`
    ListUsers,
    /// `AdminService.GetUser`
    GetUser,
}

impl AdminOperation {
    fn as_str(self) -> &'static str {
        match self {
            Self::GetPostgresInfo => "get_postgres_info",
            Self::GetTables => "get_tables",
            Self::GetColumns => "get_columns",
            Self::GetRows => "get_rows",
            Self::GetRedisKeys => "get_redis_keys",
            Self::GetRedisValue => "get_redis_value",
            Self::DeleteRedisKey => "delete_redis_key",
            Self::GetRedisDbSize => "get_redis_db_size",
            Self::GetContext => "get_context",
            Self::ListGroups => "list_groups",
            Self::GetGroup => "get_group",
            Self::CreateGroup => "create_group",
            Self::UpdateGroup => "update_group",
            Self::DeleteGroup => "delete_group",
            Self::GetGroupMembers => "get_group_members",
            Self::AddGroupMember => "add_group_member",
            Self::RemoveGroupMember => "remove_group_member",
            Self::ListOrganizations => "list_organizations",
            Self::GetOrganization => "get_organization",
            Self::GetOrgUsers => "get_org_users",
            Self::GetOrgGroups => "get_org_groups",
            Self::ListUsers => "list_users",
            Self::GetUser => "get_user",
        }
    }

    fn required_scope(self) -> AdminOperationScope {
        match self {
            Self::GetPostgresInfo
            | Self::GetTables
            | Self::GetColumns
            | Self::GetRows
            | Self::GetRedisKeys
            | Self::GetRedisValue
            | Self::DeleteRedisKey
            | Self::GetRedisDbSize => AdminOperationScope::RootOnly,
            Self::GetContext
            | Self::ListGroups
            | Self::GetGroup
            | Self::CreateGroup
            | Self::UpdateGroup
            | Self::DeleteGroup
            | Self::GetGroupMembers
            | Self::AddGroupMember
            | Self::RemoveGroupMember
            | Self::ListOrganizations
            | Self::GetOrganization
            | Self::GetOrgUsers
            | Self::GetOrgGroups
            | Self::ListUsers
            | Self::GetUser => AdminOperationScope::ScopedOrRoot,
        }
    }
}

/// Error categories returned by admin auth policy checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdminAuthErrorKind {
    /// Caller is not authenticated.
    Unauthenticated,
    /// Caller is authenticated but not authorized for the operation.
    PermissionDenied,
    /// Auth policy could not be evaluated due to internal errors.
    Internal,
}

/// Typed auth policy error for mapping into transport status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminAuthError {
    kind: AdminAuthErrorKind,
    message: String,
}

impl AdminAuthError {
    /// Constructs an auth policy error from kind and message.
    pub fn new(kind: AdminAuthErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    fn kind(&self) -> AdminAuthErrorKind {
        self.kind
    }

    fn message(&self) -> &str {
        &self.message
    }
}

/// Authorization boundary for admin handler operations.
pub trait AdminRequestAuthorizer: Send + Sync {
    /// Verifies that request metadata grants access and resolves admin scope.
    fn authorize_admin_operation(
        &self,
        operation: AdminOperation,
        metadata: &MetadataMap,
    ) -> Result<AdminAccessContext, AdminAuthError>;
}

/// Header-based authorization policy requiring `x-tearleads-role: admin`.
///
/// Scope semantics:
/// - Root-only operations require root access.
/// - Scoped operations allow root or org-scoped admins.
#[derive(Debug, Clone, Copy)]
pub struct HeaderRoleAdminAuthorizer;

impl HeaderRoleAdminAuthorizer {
    const ROLE_HEADER: &'static str = "x-tearleads-role";
    const SCOPE_HEADER: &'static str = "x-tearleads-admin-scope";
    const ORGANIZATION_IDS_HEADER: &'static str = "x-tearleads-admin-organization-ids";
    const REQUIRED_ROLE: &'static str = "admin";
    const ROOT_SCOPE: &'static str = "root";
    const ORG_SCOPE: &'static str = "org";

    fn parse_scope_metadata(
        operation: AdminOperation,
        metadata: &MetadataMap,
    ) -> Result<Option<AdminAccessContext>, AdminAuthError> {
        let Some(scope_value) = metadata.get(Self::SCOPE_HEADER) else {
            return Ok(None);
        };

        let scope = scope_value.to_str().map_err(|_| {
            AdminAuthError::new(
                AdminAuthErrorKind::Unauthenticated,
                format!("invalid {} for {}", Self::SCOPE_HEADER, operation.as_str()),
            )
        })?;
        let normalized_scope = scope.trim().to_ascii_lowercase();

        match normalized_scope.as_str() {
            Self::ROOT_SCOPE => Ok(Some(AdminAccessContext::root())),
            Self::ORG_SCOPE => {
                let organization_ids = metadata
                    .get(Self::ORGANIZATION_IDS_HEADER)
                    .ok_or_else(|| {
                        AdminAuthError::new(
                            AdminAuthErrorKind::PermissionDenied,
                            format!(
                                "missing {} for {}",
                                Self::ORGANIZATION_IDS_HEADER,
                                operation.as_str()
                            ),
                        )
                    })?
                    .to_str()
                    .map_err(|_| {
                        AdminAuthError::new(
                            AdminAuthErrorKind::Unauthenticated,
                            format!(
                                "invalid {} for {}",
                                Self::ORGANIZATION_IDS_HEADER,
                                operation.as_str()
                            ),
                        )
                    })?
                    .split(',')
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>();

                if organization_ids.is_empty() {
                    return Err(AdminAuthError::new(
                        AdminAuthErrorKind::PermissionDenied,
                        format!(
                            "scoped admin must include at least one organization id for {}",
                            operation.as_str()
                        ),
                    ));
                }

                Ok(Some(AdminAccessContext::scoped(organization_ids)))
            }
            _ => Err(AdminAuthError::new(
                AdminAuthErrorKind::PermissionDenied,
                format!(
                    "invalid {} value for {}",
                    Self::SCOPE_HEADER,
                    operation.as_str()
                ),
            )),
        }
    }
}

impl AdminRequestAuthorizer for HeaderRoleAdminAuthorizer {
    fn authorize_admin_operation(
        &self,
        operation: AdminOperation,
        metadata: &MetadataMap,
    ) -> Result<AdminAccessContext, AdminAuthError> {
        let role_value = metadata.get(Self::ROLE_HEADER).ok_or_else(|| {
            AdminAuthError::new(
                AdminAuthErrorKind::Unauthenticated,
                format!("missing {} for {}", Self::ROLE_HEADER, operation.as_str()),
            )
        })?;

        let role = role_value.to_str().map_err(|_| {
            AdminAuthError::new(
                AdminAuthErrorKind::Unauthenticated,
                format!("invalid {} for {}", Self::ROLE_HEADER, operation.as_str()),
            )
        })?;

        if role != Self::REQUIRED_ROLE {
            return Err(AdminAuthError::new(
                AdminAuthErrorKind::PermissionDenied,
                format!("admin role required for {}", operation.as_str()),
            ));
        }

        let scope_from_headers = Self::parse_scope_metadata(operation, metadata)?;
        match operation.required_scope() {
            AdminOperationScope::RootOnly => {
                let scope = scope_from_headers.ok_or_else(|| {
                    AdminAuthError::new(
                        AdminAuthErrorKind::PermissionDenied,
                        format!("missing {} for {}", Self::SCOPE_HEADER, operation.as_str()),
                    )
                })?;
                if !scope.is_root_admin() {
                    return Err(AdminAuthError::new(
                        AdminAuthErrorKind::PermissionDenied,
                        format!("root admin scope required for {}", operation.as_str()),
                    ));
                }
                Ok(AdminAccessContext::root())
            }
            AdminOperationScope::ScopedOrRoot => scope_from_headers.ok_or_else(|| {
                AdminAuthError::new(
                    AdminAuthErrorKind::PermissionDenied,
                    format!("missing {} for {}", Self::SCOPE_HEADER, operation.as_str()),
                )
            }),
        }
    }
}

/// Maps an auth policy error to gRPC status.
pub fn map_admin_auth_error(error: AdminAuthError) -> Status {
    match error.kind() {
        AdminAuthErrorKind::Unauthenticated => Status::unauthenticated(error.message().to_string()),
        AdminAuthErrorKind::PermissionDenied => {
            Status::permission_denied(error.message().to_string())
        }
        AdminAuthErrorKind::Internal => Status::internal("admin authorization failed"),
    }
}

#[cfg(test)]
mod tests;

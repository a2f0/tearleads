use tearleads_api_v2_contracts::tearleads::v2::{
    AdminGetContextRequest, AdminGetContextResponse, AdminGetGroupMembersRequest,
    AdminGetGroupMembersResponse, AdminGetOrgGroupsRequest, AdminGetOrgGroupsResponse,
    AdminGetOrganizationRequest, AdminGetOrganizationResponse, AdminGetUserRequest,
    AdminGetUserResponse, AdminGroupMember, AdminOrganization, AdminOrganizationGroup,
    AdminScopeOrganization, AdminUser, AdminUserAccounting,
};
use tearleads_data_access_traits::{
    AdminUserSummary, PostgresAdminReadRepository, RedisAdminRepository,
};
use tonic::{Request, Response, Status};

use crate::admin_auth::{AdminOperation, AdminRequestAuthorizer, map_admin_auth_error};
use crate::admin_service_common::{
    map_data_access_error, normalize_required_resource_id, resolve_organization_scope_filter,
};

use super::AdminServiceHandler;

pub(super) fn map_admin_user(user: AdminUserSummary) -> AdminUser {
    AdminUser {
        id: user.id,
        email: user.email,
        email_confirmed: user.email_confirmed,
        admin: user.admin,
        organization_ids: user.organization_ids,
        created_at: user.created_at,
        last_active_at: user.last_active_at,
        accounting: Some(AdminUserAccounting {
            total_prompt_tokens: user.accounting.total_prompt_tokens,
            total_completion_tokens: user.accounting.total_completion_tokens,
            total_tokens: user.accounting.total_tokens,
            request_count: user.accounting.request_count,
            last_used_at: user.accounting.last_used_at,
        }),
        disabled: user.disabled,
        disabled_at: user.disabled_at,
        disabled_by: user.disabled_by,
        marked_for_deletion_at: user.marked_for_deletion_at,
        marked_for_deletion_by: user.marked_for_deletion_by,
    }
}

impl<P, R, A> AdminServiceHandler<P, R, A>
where
    P: PostgresAdminReadRepository + Send + Sync + 'static,
    R: RedisAdminRepository + Send + Sync + 'static,
    A: AdminRequestAuthorizer + Send + Sync + 'static,
{
    pub(super) async fn get_context_impl(
        &self,
        request: Request<AdminGetContextRequest>,
    ) -> Result<Response<AdminGetContextResponse>, Status> {
        let admin_access = self
            .authorizer
            .authorize_admin_operation(AdminOperation::GetContext, request.metadata())
            .map_err(map_admin_auth_error)?;
        let _ = request.into_inner();

        let organizations = if admin_access.is_root_admin() {
            self.postgres_repo
                .list_scope_organizations()
                .await
                .map_err(map_data_access_error)?
        } else {
            self.postgres_repo
                .list_scope_organizations_by_ids(admin_access.organization_ids().to_vec())
                .await
                .map_err(map_data_access_error)?
        };

        let default_organization_id = if admin_access.is_root_admin() {
            None
        } else {
            organizations
                .first()
                .map(|organization| organization.id.clone())
        };

        let organizations = organizations
            .into_iter()
            .map(|organization| AdminScopeOrganization {
                id: organization.id,
                name: organization.name,
            })
            .collect();

        Ok(Response::new(AdminGetContextResponse {
            is_root_admin: admin_access.is_root_admin(),
            organizations,
            default_organization_id,
        }))
    }

    pub(super) async fn get_group_members_impl(
        &self,
        request: Request<AdminGetGroupMembersRequest>,
    ) -> Result<Response<AdminGetGroupMembersResponse>, Status> {
        let admin_access = self
            .authorizer
            .authorize_admin_operation(AdminOperation::GetGroupMembers, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let group_id =
            normalize_required_resource_id("id", &payload.id).map_err(Status::invalid_argument)?;

        let group = self
            .postgres_repo
            .get_group(&group_id)
            .await
            .map_err(map_data_access_error)?;

        if !admin_access.is_root_admin()
            && !admin_access
                .organization_ids()
                .iter()
                .any(|id| id == &group.organization_id)
        {
            return Err(Status::permission_denied("forbidden organization scope"));
        }

        let members = group
            .members
            .into_iter()
            .map(|member| AdminGroupMember {
                user_id: member.user_id,
                email: member.email,
                joined_at: member.joined_at,
            })
            .collect();

        Ok(Response::new(AdminGetGroupMembersResponse { members }))
    }

    pub(super) async fn get_organization_impl(
        &self,
        request: Request<AdminGetOrganizationRequest>,
    ) -> Result<Response<AdminGetOrganizationResponse>, Status> {
        let admin_access = self
            .authorizer
            .authorize_admin_operation(AdminOperation::GetOrganization, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let organization_id =
            normalize_required_resource_id("id", &payload.id).map_err(Status::invalid_argument)?;
        let organization_ids =
            resolve_organization_scope_filter(&admin_access, Some(organization_id.clone()))
                .map_err(Status::permission_denied)?;

        let organization = self
            .postgres_repo
            .list_organizations(organization_ids)
            .await
            .map_err(map_data_access_error)?
            .into_iter()
            .find(|organization| organization.id == organization_id);
        let organization = match organization {
            Some(organization) => organization,
            None => return Err(Status::not_found("organization not found")),
        };

        Ok(Response::new(AdminGetOrganizationResponse {
            organization: Some(AdminOrganization {
                id: organization.id,
                name: organization.name,
                description: organization.description,
                created_at: organization.created_at,
                updated_at: organization.updated_at,
            }),
        }))
    }

    pub(super) async fn get_org_groups_impl(
        &self,
        request: Request<AdminGetOrgGroupsRequest>,
    ) -> Result<Response<AdminGetOrgGroupsResponse>, Status> {
        let admin_access = self
            .authorizer
            .authorize_admin_operation(AdminOperation::GetOrgGroups, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let organization_id =
            normalize_required_resource_id("id", &payload.id).map_err(Status::invalid_argument)?;
        let organization_ids =
            resolve_organization_scope_filter(&admin_access, Some(organization_id.clone()))
                .map_err(Status::permission_denied)?;

        let groups = self
            .postgres_repo
            .list_groups(organization_ids)
            .await
            .map_err(map_data_access_error)?
            .into_iter()
            .map(|group| AdminOrganizationGroup {
                id: group.id,
                name: group.name,
                description: group.description,
                member_count: group.member_count,
            })
            .collect();

        Ok(Response::new(AdminGetOrgGroupsResponse { groups }))
    }

    pub(super) async fn get_user_impl(
        &self,
        request: Request<AdminGetUserRequest>,
    ) -> Result<Response<AdminGetUserResponse>, Status> {
        let admin_access = self
            .authorizer
            .authorize_admin_operation(AdminOperation::GetUser, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let user_id =
            normalize_required_resource_id("id", &payload.id).map_err(Status::invalid_argument)?;
        let organization_ids = if admin_access.is_root_admin() {
            None
        } else {
            Some(admin_access.organization_ids().to_vec())
        };

        let user = self
            .postgres_repo
            .list_users(organization_ids)
            .await
            .map_err(map_data_access_error)?
            .into_iter()
            .find(|user| user.id == user_id);
        let user = match user {
            Some(user) => user,
            None => return Err(Status::not_found("user not found")),
        };

        Ok(Response::new(AdminGetUserResponse {
            user: Some(map_admin_user(user)),
        }))
    }
}

use tearleads_api_v2_contracts::tearleads::v2::{
    AdminAddGroupMemberRequest, AdminAddGroupMemberResponse, AdminCreateGroupRequest,
    AdminCreateGroupResponse, AdminDeleteGroupRequest, AdminDeleteGroupResponse, AdminGroup,
    AdminRemoveGroupMemberRequest, AdminRemoveGroupMemberResponse, AdminUpdateGroupRequest,
    AdminUpdateGroupResponse,
};
use tearleads_data_access_traits::{
    AdminCreateGroupInput, AdminGroupDetail, AdminUpdateGroupInput, PostgresAdminReadRepository,
    RedisAdminRepository,
};
use tonic::{Request, Response, Status};

use crate::AdminAccessContext;
use crate::admin_auth::{AdminOperation, AdminRequestAuthorizer, map_admin_auth_error};
use crate::admin_service_common::{map_data_access_error, normalize_required_resource_id};

use super::AdminServiceHandler;

fn has_group_scope(admin_access: &AdminAccessContext, organization_id: &str) -> bool {
    admin_access.is_root_admin()
        || admin_access
            .organization_ids()
            .iter()
            .any(|id| id == organization_id)
}

fn map_admin_group(group: AdminGroupDetail) -> AdminGroup {
    AdminGroup {
        id: group.id,
        organization_id: group.organization_id,
        name: group.name,
        description: group.description,
        created_at: group.created_at,
        updated_at: group.updated_at,
    }
}

impl<P, R, A> AdminServiceHandler<P, R, A>
where
    P: PostgresAdminReadRepository + Send + Sync + 'static,
    R: RedisAdminRepository + Send + Sync + 'static,
    A: AdminRequestAuthorizer + Send + Sync + 'static,
{
    pub(super) async fn create_group_impl(
        &self,
        request: Request<AdminCreateGroupRequest>,
    ) -> Result<Response<AdminCreateGroupResponse>, Status> {
        let admin_access = self
            .authorizer
            .authorize_admin_operation(AdminOperation::CreateGroup, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let organization_id =
            normalize_required_resource_id("organization_id", &payload.organization_id)
                .map_err(Status::invalid_argument)?;
        let name = normalize_required_resource_id("name", &payload.name)
            .map_err(Status::invalid_argument)?;
        if !has_group_scope(&admin_access, &organization_id) {
            return Err(Status::permission_denied("forbidden organization scope"));
        }

        let description = payload.description.and_then(|description| {
            let trimmed = description.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });

        let group = self
            .postgres_repo
            .create_group(AdminCreateGroupInput {
                organization_id,
                name,
                description,
            })
            .await
            .map_err(map_data_access_error)?;

        Ok(Response::new(AdminCreateGroupResponse {
            group: Some(map_admin_group(group)),
        }))
    }

    pub(super) async fn update_group_impl(
        &self,
        request: Request<AdminUpdateGroupRequest>,
    ) -> Result<Response<AdminUpdateGroupResponse>, Status> {
        let admin_access = self
            .authorizer
            .authorize_admin_operation(AdminOperation::UpdateGroup, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let group_id =
            normalize_required_resource_id("id", &payload.id).map_err(Status::invalid_argument)?;
        let current_group = self
            .postgres_repo
            .get_group(&group_id)
            .await
            .map_err(map_data_access_error)?;
        if !has_group_scope(&admin_access, &current_group.organization_id) {
            return Err(Status::permission_denied("forbidden organization scope"));
        }

        let organization_id = payload
            .organization_id
            .map(|value| normalize_required_resource_id("organization_id", &value))
            .transpose()
            .map_err(Status::invalid_argument)?;
        if let Some(target_organization_id) = organization_id.as_deref() {
            if !has_group_scope(&admin_access, target_organization_id) {
                return Err(Status::permission_denied("forbidden organization scope"));
            }
        }

        let name = payload
            .name
            .map(|value| normalize_required_resource_id("name", &value))
            .transpose()
            .map_err(Status::invalid_argument)?;
        let description = payload.description.map(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });

        let update_input = AdminUpdateGroupInput {
            name,
            organization_id,
            description,
        };
        if update_input.name.is_none()
            && update_input.organization_id.is_none()
            && update_input.description.is_none()
        {
            return Err(Status::invalid_argument("no fields to update"));
        }

        let group = self
            .postgres_repo
            .update_group(&group_id, update_input)
            .await
            .map_err(map_data_access_error)?;

        Ok(Response::new(AdminUpdateGroupResponse {
            group: Some(map_admin_group(group)),
        }))
    }

    pub(super) async fn delete_group_impl(
        &self,
        request: Request<AdminDeleteGroupRequest>,
    ) -> Result<Response<AdminDeleteGroupResponse>, Status> {
        let admin_access = self
            .authorizer
            .authorize_admin_operation(AdminOperation::DeleteGroup, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let group_id =
            normalize_required_resource_id("id", &payload.id).map_err(Status::invalid_argument)?;
        let group = self
            .postgres_repo
            .get_group(&group_id)
            .await
            .map_err(map_data_access_error)?;
        if !has_group_scope(&admin_access, &group.organization_id) {
            return Err(Status::permission_denied("forbidden organization scope"));
        }

        let deleted = self
            .postgres_repo
            .delete_group(&group_id)
            .await
            .map_err(map_data_access_error)?;
        Ok(Response::new(AdminDeleteGroupResponse { deleted }))
    }

    pub(super) async fn add_group_member_impl(
        &self,
        request: Request<AdminAddGroupMemberRequest>,
    ) -> Result<Response<AdminAddGroupMemberResponse>, Status> {
        let admin_access = self
            .authorizer
            .authorize_admin_operation(AdminOperation::AddGroupMember, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let group_id =
            normalize_required_resource_id("id", &payload.id).map_err(Status::invalid_argument)?;
        let user_id = normalize_required_resource_id("user_id", &payload.user_id)
            .map_err(Status::invalid_argument)?;
        let group = self
            .postgres_repo
            .get_group(&group_id)
            .await
            .map_err(map_data_access_error)?;
        if !has_group_scope(&admin_access, &group.organization_id) {
            return Err(Status::permission_denied("forbidden organization scope"));
        }

        let added = self
            .postgres_repo
            .add_group_member(&group_id, &user_id)
            .await
            .map_err(map_data_access_error)?;
        Ok(Response::new(AdminAddGroupMemberResponse { added }))
    }

    pub(super) async fn remove_group_member_impl(
        &self,
        request: Request<AdminRemoveGroupMemberRequest>,
    ) -> Result<Response<AdminRemoveGroupMemberResponse>, Status> {
        let admin_access = self
            .authorizer
            .authorize_admin_operation(AdminOperation::RemoveGroupMember, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let group_id = normalize_required_resource_id("group_id", &payload.group_id)
            .map_err(Status::invalid_argument)?;
        let user_id = normalize_required_resource_id("user_id", &payload.user_id)
            .map_err(Status::invalid_argument)?;
        let group = self
            .postgres_repo
            .get_group(&group_id)
            .await
            .map_err(map_data_access_error)?;
        if !has_group_scope(&admin_access, &group.organization_id) {
            return Err(Status::permission_denied("forbidden organization scope"));
        }

        let removed = self
            .postgres_repo
            .remove_group_member(&group_id, &user_id)
            .await
            .map_err(map_data_access_error)?;
        Ok(Response::new(AdminRemoveGroupMemberResponse { removed }))
    }
}

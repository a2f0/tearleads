use tearleads_api_v2_contracts::tearleads::v2::{
    AdminGroupWithMemberCount, AdminListGroupsRequest, AdminListGroupsResponse,
    AdminListOrganizationsRequest, AdminListOrganizationsResponse, AdminListUsersRequest,
    AdminListUsersResponse, AdminOrganization,
};
use tearleads_data_access_traits::{PostgresAdminReadRepository, RedisAdminRepository};
use tonic::{Request, Response, Status};

use crate::admin_auth::{AdminOperation, AdminRequestAuthorizer, map_admin_auth_error};
use crate::admin_service_common::{
    map_data_access_error, normalize_optional_organization_id, resolve_organization_scope_filter,
};

use super::{AdminServiceHandler, detail_reads};

impl<P, R, A> AdminServiceHandler<P, R, A>
where
    P: PostgresAdminReadRepository + Send + Sync + 'static,
    R: RedisAdminRepository + Send + Sync + 'static,
    A: AdminRequestAuthorizer + Send + Sync + 'static,
{
    pub(super) async fn list_groups_impl(
        &self,
        request: Request<AdminListGroupsRequest>,
    ) -> Result<Response<AdminListGroupsResponse>, Status> {
        let admin_access = self
            .authorizer
            .authorize_admin_operation(AdminOperation::ListGroups, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let requested_organization_id = normalize_optional_organization_id(payload.organization_id);
        let organization_ids =
            resolve_organization_scope_filter(&admin_access, requested_organization_id)
                .map_err(Status::permission_denied)?;

        let groups = self
            .postgres_repo
            .list_groups(organization_ids)
            .await
            .map_err(map_data_access_error)?
            .into_iter()
            .map(|group| AdminGroupWithMemberCount {
                id: group.id,
                organization_id: group.organization_id,
                name: group.name,
                description: group.description,
                created_at: group.created_at,
                updated_at: group.updated_at,
                member_count: group.member_count,
            })
            .collect();

        Ok(Response::new(AdminListGroupsResponse { groups }))
    }

    pub(super) async fn list_organizations_impl(
        &self,
        request: Request<AdminListOrganizationsRequest>,
    ) -> Result<Response<AdminListOrganizationsResponse>, Status> {
        let admin_access = self
            .authorizer
            .authorize_admin_operation(AdminOperation::ListOrganizations, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let requested_organization_id = normalize_optional_organization_id(payload.organization_id);
        let organization_ids =
            resolve_organization_scope_filter(&admin_access, requested_organization_id)
                .map_err(Status::permission_denied)?;

        let organizations = self
            .postgres_repo
            .list_organizations(organization_ids)
            .await
            .map_err(map_data_access_error)?
            .into_iter()
            .map(|organization| AdminOrganization {
                id: organization.id,
                name: organization.name,
                description: organization.description,
                created_at: organization.created_at,
                updated_at: organization.updated_at,
            })
            .collect();

        Ok(Response::new(AdminListOrganizationsResponse {
            organizations,
        }))
    }

    pub(super) async fn list_users_impl(
        &self,
        request: Request<AdminListUsersRequest>,
    ) -> Result<Response<AdminListUsersResponse>, Status> {
        let admin_access = self
            .authorizer
            .authorize_admin_operation(AdminOperation::ListUsers, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let requested_organization_id = normalize_optional_organization_id(payload.organization_id);
        let organization_ids =
            resolve_organization_scope_filter(&admin_access, requested_organization_id)
                .map_err(Status::permission_denied)?;

        let users = self
            .postgres_repo
            .list_users(organization_ids)
            .await
            .map_err(map_data_access_error)?
            .into_iter()
            .map(detail_reads::map_admin_user)
            .collect();

        Ok(Response::new(AdminListUsersResponse { users }))
    }
}

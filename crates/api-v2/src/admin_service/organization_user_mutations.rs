use tearleads_api_v2_contracts::tearleads::v2::{
    AdminCreateOrganizationRequest, AdminCreateOrganizationResponse,
    AdminDeleteOrganizationRequest, AdminDeleteOrganizationResponse, AdminOrganization,
    AdminUpdateOrganizationRequest, AdminUpdateOrganizationResponse, AdminUpdateUserRequest,
    AdminUpdateUserResponse,
};
use tearleads_data_access_traits::{
    AdminCreateOrganizationInput, AdminOrganizationSummary, AdminUpdateOrganizationInput,
    AdminUpdateUserInput, PostgresAdminReadRepository, RedisAdminRepository,
};
use tonic::{Request, Response, Status};

use crate::admin_auth::{AdminOperation, AdminRequestAuthorizer, map_admin_auth_error};
use crate::admin_service_common::{map_data_access_error, normalize_required_resource_id};

use super::{AdminServiceHandler, detail_reads};

fn map_admin_organization(organization: AdminOrganizationSummary) -> AdminOrganization {
    AdminOrganization {
        id: organization.id,
        name: organization.name,
        description: organization.description,
        created_at: organization.created_at,
        updated_at: organization.updated_at,
    }
}

fn normalize_optional_patch_field(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

impl<P, R, A> AdminServiceHandler<P, R, A>
where
    P: PostgresAdminReadRepository + Send + Sync + 'static,
    R: RedisAdminRepository + Send + Sync + 'static,
    A: AdminRequestAuthorizer + Send + Sync + 'static,
{
    pub(super) async fn create_organization_impl(
        &self,
        request: Request<AdminCreateOrganizationRequest>,
    ) -> Result<Response<AdminCreateOrganizationResponse>, Status> {
        self.authorizer
            .authorize_admin_operation(AdminOperation::CreateOrganization, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let name = normalize_required_resource_id("name", &payload.name)
            .map_err(Status::invalid_argument)?;
        let description = payload.description.and_then(normalize_optional_patch_field);

        let organization = self
            .postgres_repo
            .create_organization(AdminCreateOrganizationInput { name, description })
            .await
            .map_err(map_data_access_error)?;

        Ok(Response::new(AdminCreateOrganizationResponse {
            organization: Some(map_admin_organization(organization)),
        }))
    }

    pub(super) async fn update_organization_impl(
        &self,
        request: Request<AdminUpdateOrganizationRequest>,
    ) -> Result<Response<AdminUpdateOrganizationResponse>, Status> {
        self.authorizer
            .authorize_admin_operation(AdminOperation::UpdateOrganization, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let organization_id =
            normalize_required_resource_id("id", &payload.id).map_err(Status::invalid_argument)?;
        let name = payload
            .name
            .map(|value| normalize_required_resource_id("name", &value))
            .transpose()
            .map_err(Status::invalid_argument)?;
        let description = payload.description.map(normalize_optional_patch_field);
        let update_input = AdminUpdateOrganizationInput { name, description };

        if update_input.name.is_none() && update_input.description.is_none() {
            return Err(Status::invalid_argument("no fields to update"));
        }

        let organization = self
            .postgres_repo
            .update_organization(&organization_id, update_input)
            .await
            .map_err(map_data_access_error)?;

        Ok(Response::new(AdminUpdateOrganizationResponse {
            organization: Some(map_admin_organization(organization)),
        }))
    }

    pub(super) async fn delete_organization_impl(
        &self,
        request: Request<AdminDeleteOrganizationRequest>,
    ) -> Result<Response<AdminDeleteOrganizationResponse>, Status> {
        self.authorizer
            .authorize_admin_operation(AdminOperation::DeleteOrganization, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let organization_id =
            normalize_required_resource_id("id", &payload.id).map_err(Status::invalid_argument)?;

        let deleted = self
            .postgres_repo
            .delete_organization(&organization_id)
            .await
            .map_err(map_data_access_error)?;

        Ok(Response::new(AdminDeleteOrganizationResponse { deleted }))
    }

    pub(super) async fn update_user_impl(
        &self,
        request: Request<AdminUpdateUserRequest>,
    ) -> Result<Response<AdminUpdateUserResponse>, Status> {
        self.authorizer
            .authorize_admin_operation(AdminOperation::UpdateUser, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let user_id =
            normalize_required_resource_id("id", &payload.id).map_err(Status::invalid_argument)?;
        let email = payload
            .email
            .map(|value| normalize_required_resource_id("email", &value))
            .transpose()
            .map_err(Status::invalid_argument)?;
        let organization_ids = payload
            .organization_ids
            .map(|input| {
                input
                    .organization_ids
                    .into_iter()
                    .map(|organization_id| {
                        normalize_required_resource_id("organization_ids", &organization_id)
                            .map_err(Status::invalid_argument)
                    })
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?;
        let update_input = AdminUpdateUserInput {
            email,
            email_confirmed: payload.email_confirmed,
            admin: payload.admin,
            organization_ids,
            disabled: payload.disabled,
            marked_for_deletion: payload.marked_for_deletion,
        };
        if update_input.email.is_none()
            && update_input.email_confirmed.is_none()
            && update_input.admin.is_none()
            && update_input.organization_ids.is_none()
            && update_input.disabled.is_none()
            && update_input.marked_for_deletion.is_none()
        {
            return Err(Status::invalid_argument("no fields to update"));
        }

        let user = self
            .postgres_repo
            .update_user(&user_id, update_input)
            .await
            .map_err(map_data_access_error)?;

        Ok(Response::new(AdminUpdateUserResponse {
            user: Some(detail_reads::map_admin_user(user)),
        }))
    }
}

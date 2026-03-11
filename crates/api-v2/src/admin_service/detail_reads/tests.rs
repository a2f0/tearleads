use tearleads_api_v2_contracts::tearleads::v2::{
    AdminGetContextRequest, AdminGetGroupMembersRequest, AdminGetGroupRequest,
    AdminGetOrgGroupsRequest, AdminGetOrgUsersRequest, AdminGetOrganizationRequest,
    AdminGetUserRequest, AdminListGroupsRequest, AdminListOrganizationsRequest,
    AdminListUsersRequest, admin_service_server::AdminService,
};
use tonic::Request;

#[tokio::test]
async fn detail_read_routes_execute_under_harness_authorizer() {
    let handler = crate::admin_harness::create_admin_handler();

    let context = handler
        .get_context(request_with_auth(AdminGetContextRequest {}))
        .await;
    assert!(context.is_ok());

    let list_groups = handler
        .list_groups(request_with_auth(AdminListGroupsRequest {
            organization_id: None,
        }))
        .await;
    assert!(list_groups.is_ok());

    let get_group = handler
        .get_group(request_with_auth(AdminGetGroupRequest {
            id: String::from("group-1"),
        }))
        .await;
    assert!(get_group.is_ok());

    let list_organizations = handler
        .list_organizations(request_with_auth(AdminListOrganizationsRequest {
            organization_id: None,
        }))
        .await;
    assert!(list_organizations.is_ok());

    let get_organization = handler
        .get_organization(request_with_auth(AdminGetOrganizationRequest {
            id: String::from("org-1"),
        }))
        .await;
    assert!(get_organization.is_ok());

    let get_org_groups = handler
        .get_org_groups(request_with_auth(AdminGetOrgGroupsRequest {
            id: String::from("org-1"),
        }))
        .await;
    assert!(get_org_groups.is_ok());

    let get_org_users = handler
        .get_org_users(request_with_auth(AdminGetOrgUsersRequest {
            id: String::from("org-1"),
        }))
        .await;
    assert!(get_org_users.is_ok());

    let list_users = handler
        .list_users(request_with_auth(AdminListUsersRequest {
            organization_id: None,
        }))
        .await;
    assert!(list_users.is_ok());

    let get_user = handler
        .get_user(request_with_auth(AdminGetUserRequest {
            id: String::from("user-1"),
        }))
        .await;
    assert!(get_user.is_ok());

    let get_group_members = handler
        .get_group_members(request_with_auth(AdminGetGroupMembersRequest {
            id: String::from("group-1"),
        }))
        .await;
    assert!(get_group_members.is_ok());
}

fn request_with_auth<T>(payload: T) -> Request<T> {
    let mut request = Request::new(payload);
    request.metadata_mut().insert(
        "authorization",
        tonic::metadata::MetadataValue::from_static("Bearer header.payload.signature"),
    );
    request
}

use super::support::admin_service::{FakeAuthorizer, FakePostgresGateway, FakeRedisRepository};
use tearleads_api_v2::{AdminAuthErrorKind, AdminServiceHandler};
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminGetContextRequest, AdminGetGroupMembersRequest, AdminGetOrgGroupsRequest,
    AdminGetOrgUsersRequest, AdminGetOrganizationRequest, AdminGetUserRequest,
    AdminListOrganizationsRequest, admin_service_server::AdminService,
};
use tearleads_data_access_traits::{DataAccessError, DataAccessErrorKind};
use tonic::{Code, Request};

#[tokio::test]
async fn detail_read_routes_map_authorizer_denials() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresGateway::default(),
        FakeRedisRepository::default(),
        FakeAuthorizer::deny(AdminAuthErrorKind::PermissionDenied, "denied"),
    );

    let get_group_members_status = match handler
        .get_group_members(Request::new(AdminGetGroupMembersRequest {
            id: String::from("group-1"),
        }))
        .await
    {
        Ok(_) => panic!("get_group_members should fail when authorizer denies access"),
        Err(error) => error,
    };
    assert_eq!(get_group_members_status.code(), Code::PermissionDenied);

    let get_organization_status = match handler
        .get_organization(Request::new(AdminGetOrganizationRequest {
            id: String::from("org-1"),
        }))
        .await
    {
        Ok(_) => panic!("get_organization should fail when authorizer denies access"),
        Err(error) => error,
    };
    assert_eq!(get_organization_status.code(), Code::PermissionDenied);

    let get_org_groups_status = match handler
        .get_org_groups(Request::new(AdminGetOrgGroupsRequest {
            id: String::from("org-1"),
        }))
        .await
    {
        Ok(_) => panic!("get_org_groups should fail when authorizer denies access"),
        Err(error) => error,
    };
    assert_eq!(get_org_groups_status.code(), Code::PermissionDenied);

    let get_org_users_status = match handler
        .get_org_users(Request::new(AdminGetOrgUsersRequest {
            id: String::from("org-1"),
        }))
        .await
    {
        Ok(_) => panic!("get_org_users should fail when authorizer denies access"),
        Err(error) => error,
    };
    assert_eq!(get_org_users_status.code(), Code::PermissionDenied);

    let get_user_status = match handler
        .get_user(Request::new(AdminGetUserRequest {
            id: String::from("user-1"),
        }))
        .await
    {
        Ok(_) => panic!("get_user should fail when authorizer denies access"),
        Err(error) => error,
    };
    assert_eq!(get_user_status.code(), Code::PermissionDenied);
}

#[tokio::test]
async fn detail_read_routes_reject_blank_required_ids() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresGateway::default(),
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let get_organization_status = match handler
        .get_organization(Request::new(AdminGetOrganizationRequest {
            id: String::from("   "),
        }))
        .await
    {
        Ok(_) => panic!("blank organization id should fail"),
        Err(error) => error,
    };
    assert_eq!(get_organization_status.code(), Code::InvalidArgument);

    let get_org_groups_status = match handler
        .get_org_groups(Request::new(AdminGetOrgGroupsRequest {
            id: String::from("   "),
        }))
        .await
    {
        Ok(_) => panic!("blank organization id should fail"),
        Err(error) => error,
    };
    assert_eq!(get_org_groups_status.code(), Code::InvalidArgument);

    let get_org_users_status = match handler
        .get_org_users(Request::new(AdminGetOrgUsersRequest {
            id: String::from("   "),
        }))
        .await
    {
        Ok(_) => panic!("blank organization id should fail"),
        Err(error) => error,
    };
    assert_eq!(get_org_users_status.code(), Code::InvalidArgument);

    let get_user_status = match handler
        .get_user(Request::new(AdminGetUserRequest {
            id: String::from("   "),
        }))
        .await
    {
        Ok(_) => panic!("blank user id should fail"),
        Err(error) => error,
    };
    assert_eq!(get_user_status.code(), Code::InvalidArgument);
}

#[tokio::test]
async fn scoped_filter_denials_map_to_permission_denied() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresGateway::default(),
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let get_organization_status = match handler
        .get_organization(Request::new(AdminGetOrganizationRequest {
            id: String::from("org-9"),
        }))
        .await
    {
        Ok(_) => panic!("out-of-scope organization should fail"),
        Err(error) => error,
    };
    assert_eq!(get_organization_status.code(), Code::PermissionDenied);

    let get_org_groups_status = match handler
        .get_org_groups(Request::new(AdminGetOrgGroupsRequest {
            id: String::from("org-9"),
        }))
        .await
    {
        Ok(_) => panic!("out-of-scope organization should fail"),
        Err(error) => error,
    };
    assert_eq!(get_org_groups_status.code(), Code::PermissionDenied);

    let get_org_users_status = match handler
        .get_org_users(Request::new(AdminGetOrgUsersRequest {
            id: String::from("org-9"),
        }))
        .await
    {
        Ok(_) => panic!("out-of-scope organization should fail"),
        Err(error) => error,
    };
    assert_eq!(get_org_users_status.code(), Code::PermissionDenied);

    let list_organizations_status = match handler
        .list_organizations(Request::new(AdminListOrganizationsRequest {
            organization_id: Some(String::from("org-9")),
        }))
        .await
    {
        Ok(_) => panic!("out-of-scope organization filter should fail"),
        Err(error) => error,
    };
    assert_eq!(list_organizations_status.code(), Code::PermissionDenied);
}

#[tokio::test]
async fn get_context_maps_root_repository_errors() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresGateway {
            scope_organizations_result: Err(DataAccessError::new(
                DataAccessErrorKind::NotFound,
                "scope organizations unavailable",
            )),
            ..Default::default()
        },
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_context(Request::new(AdminGetContextRequest {}))
        .await;
    let status = match result {
        Ok(_) => panic!("root context should map repository errors"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::NotFound);
    assert_eq!(status.message(), "scope organizations unavailable");
}

#[tokio::test]
async fn get_context_maps_scoped_repository_errors() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresGateway {
            scope_organizations_by_ids_result: Err(DataAccessError::new(
                DataAccessErrorKind::NotFound,
                "scoped organizations unavailable",
            )),
            ..Default::default()
        },
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let result = handler
        .get_context(Request::new(AdminGetContextRequest {}))
        .await;
    let status = match result {
        Ok(_) => panic!("scoped context should map repository errors"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::NotFound);
    assert_eq!(status.message(), "scoped organizations unavailable");
}

#[tokio::test]
async fn get_group_members_maps_repository_errors() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresGateway {
            get_group_result: Err(DataAccessError::new(
                DataAccessErrorKind::NotFound,
                "group lookup failed",
            )),
            ..Default::default()
        },
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_group_members(Request::new(AdminGetGroupMembersRequest {
            id: String::from("group-1"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("get_group_members should map repository errors"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::NotFound);
    assert_eq!(status.message(), "group lookup failed");
}

#[tokio::test]
async fn get_organization_maps_repository_errors() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresGateway {
            list_organizations_result: Err(DataAccessError::new(
                DataAccessErrorKind::NotFound,
                "organization query failed",
            )),
            ..Default::default()
        },
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_organization(Request::new(AdminGetOrganizationRequest {
            id: String::from("org-1"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("get_organization should map repository errors"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::NotFound);
    assert_eq!(status.message(), "organization query failed");
}

#[tokio::test]
async fn get_org_groups_maps_repository_errors() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresGateway {
            list_groups_result: Err(DataAccessError::new(
                DataAccessErrorKind::NotFound,
                "group query failed",
            )),
            ..Default::default()
        },
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_org_groups(Request::new(AdminGetOrgGroupsRequest {
            id: String::from("org-1"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("get_org_groups should map repository errors"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::NotFound);
    assert_eq!(status.message(), "group query failed");
}

#[tokio::test]
async fn get_org_users_maps_scope_lookup_errors() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresGateway {
            list_organizations_result: Err(DataAccessError::new(
                DataAccessErrorKind::NotFound,
                "scope lookup failed",
            )),
            ..Default::default()
        },
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_org_users(Request::new(AdminGetOrgUsersRequest {
            id: String::from("org-1"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("get_org_users should map repository errors"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::NotFound);
    assert_eq!(status.message(), "scope lookup failed");
}

#[tokio::test]
async fn get_user_maps_repository_errors() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresGateway {
            get_user_result: Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "user lookup failed",
            )),
            ..Default::default()
        },
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_user(Request::new(AdminGetUserRequest {
            id: String::from("user-1"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("get_user should map repository errors"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::Internal);
    assert_eq!(status.message(), "internal data access error");
}

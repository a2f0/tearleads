//! Integration tests for v2 admin list-groups handler behavior.

use std::sync::Arc;

// support module provided by parent test crate

use super::support::admin_service::{
    FakeAuthorizer, FakePostgresRepository, FakeRedisRepository, into_inner_or_panic,
    lock_or_recover,
};
use tearleads_api_v2::{AdminAuthErrorKind, AdminServiceHandler};
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminGetGroupRequest, AdminListGroupsRequest, AdminListOrganizationsRequest,
    AdminListUsersRequest, admin_service_server::AdminService,
};
use tearleads_data_access_traits::{
    AdminGroupDetail, AdminGroupMember, AdminGroupSummary, AdminOrganizationSummary,
    AdminUserAccountingSummary, AdminUserSummary, DataAccessError, DataAccessErrorKind,
};
use tonic::{Code, Request};

#[tokio::test]
async fn list_groups_for_root_admin_treats_blank_filter_as_unfiltered() {
    let postgres_repo = FakePostgresRepository {
        list_groups_result: Ok(vec![
            AdminGroupSummary {
                id: String::from("group-1"),
                organization_id: String::from("org-1"),
                name: String::from("Core Admin"),
                description: Some(String::from("Operators")),
                created_at: String::from("2026-01-01T00:00:00Z"),
                updated_at: String::from("2026-01-01T00:00:00Z"),
                member_count: 2,
            },
            AdminGroupSummary {
                id: String::from("group-2"),
                organization_id: String::from("org-2"),
                name: String::from("Support"),
                description: None,
                created_at: String::from("2026-01-02T00:00:00Z"),
                updated_at: String::from("2026-01-02T00:00:00Z"),
                member_count: 1,
            },
        ]),
        ..Default::default()
    };
    let list_groups_calls = Arc::clone(&postgres_repo.list_groups_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .list_groups(Request::new(AdminListGroupsRequest {
                organization_id: Some(String::from("   ")),
            }))
            .await,
    );

    assert_eq!(payload.groups.len(), 2);
    assert_eq!(payload.groups[0].organization_id, "org-1");
    assert_eq!(payload.groups[1].organization_id, "org-2");
    assert_eq!(lock_or_recover(&list_groups_calls).clone(), vec![None]);
}

#[tokio::test]
async fn list_groups_for_scoped_admin_defaults_to_authorized_organizations() {
    let postgres_repo = FakePostgresRepository {
        list_groups_result: Ok(vec![AdminGroupSummary {
            id: String::from("group-7"),
            organization_id: String::from("org-7"),
            name: String::from("Scoped Group"),
            description: None,
            created_at: String::from("2026-01-03T00:00:00Z"),
            updated_at: String::from("2026-01-03T00:00:00Z"),
            member_count: 4,
        }]),
        ..Default::default()
    };
    let list_groups_calls = Arc::clone(&postgres_repo.list_groups_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7"), String::from("org-9")]),
    );

    let payload = into_inner_or_panic(
        handler
            .list_groups(Request::new(AdminListGroupsRequest {
                organization_id: None,
            }))
            .await,
    );

    assert_eq!(payload.groups.len(), 1);
    assert_eq!(payload.groups[0].id, "group-7");
    assert_eq!(
        lock_or_recover(&list_groups_calls).clone(),
        vec![Some(vec![String::from("org-7"), String::from("org-9")])]
    );
}

#[tokio::test]
async fn list_groups_rejects_scoped_filter_outside_authorized_org_ids() {
    let postgres_repo = FakePostgresRepository::default();
    let list_groups_calls = Arc::clone(&postgres_repo.list_groups_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let result = handler
        .list_groups(Request::new(AdminListGroupsRequest {
            organization_id: Some(String::from("org-9")),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("out-of-scope organization filter must fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::PermissionDenied);
    assert_eq!(status.message(), "forbidden organization scope");
    assert!(lock_or_recover(&list_groups_calls).is_empty());
}

#[tokio::test]
async fn get_group_rejects_scoped_access_forbidden_organization() {
    let postgres_repo = FakePostgresRepository {
        get_group_result: Ok(AdminGroupDetail {
            id: String::from("group-1"),
            organization_id: String::from("org-1"),
            name: String::from("Core Admin"),
            description: None,
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
            members: vec![AdminGroupMember {
                user_id: String::from("user-1"),
                email: String::from("admin@example.com"),
                joined_at: String::from("2026-01-01T00:00:00Z"),
            }],
        }),
        ..Default::default()
    };
    let get_group_calls = Arc::clone(&postgres_repo.get_group_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let result = handler
        .get_group(Request::new(AdminGetGroupRequest {
            id: String::from("group-1"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("group outside scoped org should fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::PermissionDenied);
    assert_eq!(status.message(), "forbidden organization scope");
    assert_eq!(
        lock_or_recover(&get_group_calls).clone(),
        vec![String::from("group-1")]
    );
}

#[tokio::test]
async fn get_group_rejects_blank_id_before_repository_calls() {
    let postgres_repo = FakePostgresRepository::default();
    let get_group_calls = Arc::clone(&postgres_repo.get_group_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_group(Request::new(AdminGetGroupRequest {
            id: String::from("   "),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("blank group id should fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(status.message(), "id must not be empty");
    assert!(lock_or_recover(&get_group_calls).is_empty());
}

#[tokio::test]
async fn group_read_routes_map_authorizer_denials() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresRepository::default(),
        FakeRedisRepository::default(),
        FakeAuthorizer::deny(AdminAuthErrorKind::PermissionDenied, "denied"),
    );

    let list_groups_status = match handler
        .list_groups(Request::new(AdminListGroupsRequest {
            organization_id: None,
        }))
        .await
    {
        Ok(_) => panic!("list_groups should fail when authorizer denies access"),
        Err(error) => error,
    };
    assert_eq!(list_groups_status.code(), Code::PermissionDenied);
    assert_eq!(list_groups_status.message(), "denied");

    let get_group_status = match handler
        .get_group(Request::new(AdminGetGroupRequest {
            id: String::from("group-1"),
        }))
        .await
    {
        Ok(_) => panic!("get_group should fail when authorizer denies access"),
        Err(error) => error,
    };
    assert_eq!(get_group_status.code(), Code::PermissionDenied);
    assert_eq!(get_group_status.message(), "denied");

    let list_organizations_status = match handler
        .list_organizations(Request::new(AdminListOrganizationsRequest {
            organization_id: None,
        }))
        .await
    {
        Ok(_) => panic!("list_organizations should fail when authorizer denies access"),
        Err(error) => error,
    };
    assert_eq!(list_organizations_status.code(), Code::PermissionDenied);
    assert_eq!(list_organizations_status.message(), "denied");

    let list_users_status = match handler
        .list_users(Request::new(AdminListUsersRequest {
            organization_id: None,
        }))
        .await
    {
        Ok(_) => panic!("list_users should fail when authorizer denies access"),
        Err(error) => error,
    };
    assert_eq!(list_users_status.code(), Code::PermissionDenied);
    assert_eq!(list_users_status.message(), "denied");
}

#[tokio::test]
async fn list_groups_maps_repository_errors() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresRepository {
            list_groups_result: Err(DataAccessError::new(
                DataAccessErrorKind::NotFound,
                "group storage unavailable",
            )),
            ..Default::default()
        },
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .list_groups(Request::new(AdminListGroupsRequest {
            organization_id: None,
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("list_groups should map repository error"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::NotFound);
    assert_eq!(status.message(), "group storage unavailable");
}

#[tokio::test]
async fn get_group_maps_repository_errors() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresRepository {
            get_group_result: Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "group lookup failed",
            )),
            ..Default::default()
        },
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_group(Request::new(AdminGetGroupRequest {
            id: String::from("group-1"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("get_group should map repository error"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::Internal);
    assert_eq!(status.message(), "internal data access error");
}

#[tokio::test]
async fn list_organizations_maps_repository_errors() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresRepository {
            list_organizations_result: Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "organization query failed",
            )),
            ..Default::default()
        },
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .list_organizations(Request::new(AdminListOrganizationsRequest {
            organization_id: None,
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("list_organizations should map repository error"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::Internal);
    assert_eq!(status.message(), "internal data access error");
}

#[tokio::test]
async fn list_users_maps_repository_errors() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresRepository {
            list_users_result: Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "user query failed",
            )),
            ..Default::default()
        },
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .list_users(Request::new(AdminListUsersRequest {
            organization_id: None,
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("list_users should map repository error"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::Internal);
    assert_eq!(status.message(), "internal data access error");
}

#[tokio::test]
async fn list_organizations_for_scoped_admin_defaults_to_authorized_organizations() {
    let postgres_repo = FakePostgresRepository {
        list_organizations_result: Ok(vec![AdminOrganizationSummary {
            id: String::from("org-7"),
            name: String::from("Scoped Org"),
            description: None,
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
        }]),
        ..Default::default()
    };
    let list_organizations_calls = Arc::clone(&postgres_repo.list_organizations_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7"), String::from("org-9")]),
    );

    let payload = into_inner_or_panic(
        handler
            .list_organizations(Request::new(AdminListOrganizationsRequest {
                organization_id: None,
            }))
            .await,
    );

    assert_eq!(payload.organizations.len(), 1);
    assert_eq!(payload.organizations[0].id, "org-7");
    assert_eq!(
        lock_or_recover(&list_organizations_calls).clone(),
        vec![Some(vec![String::from("org-7"), String::from("org-9")])]
    );
}

#[tokio::test]
async fn list_organizations_accepts_authorized_scoped_filter() {
    let postgres_repo = FakePostgresRepository {
        list_organizations_result: Ok(vec![AdminOrganizationSummary {
            id: String::from("org-7"),
            name: String::from("Scoped Org"),
            description: None,
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
        }]),
        ..Default::default()
    };
    let list_organizations_calls = Arc::clone(&postgres_repo.list_organizations_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7"), String::from("org-9")]),
    );

    let payload = into_inner_or_panic(
        handler
            .list_organizations(Request::new(AdminListOrganizationsRequest {
                organization_id: Some(String::from("org-7")),
            }))
            .await,
    );

    assert_eq!(payload.organizations.len(), 1);
    assert_eq!(payload.organizations[0].id, "org-7");
    assert_eq!(
        lock_or_recover(&list_organizations_calls).clone(),
        vec![Some(vec![String::from("org-7")])]
    );
}

#[tokio::test]
async fn list_users_rejects_scoped_filter_outside_authorized_org_ids() {
    let postgres_repo = FakePostgresRepository {
        list_users_result: Ok(vec![AdminUserSummary {
            id: String::from("user-1"),
            email: String::from("admin@example.com"),
            email_confirmed: true,
            admin: false,
            organization_ids: vec![String::from("org-7")],
            created_at: Some(String::from("2026-01-01T00:00:00Z")),
            last_active_at: None,
            accounting: AdminUserAccountingSummary {
                total_prompt_tokens: 0,
                total_completion_tokens: 0,
                total_tokens: 0,
                request_count: 0,
                last_used_at: None,
            },
            disabled: false,
            disabled_at: None,
            disabled_by: None,
            marked_for_deletion_at: None,
            marked_for_deletion_by: None,
        }]),
        ..Default::default()
    };
    let list_users_calls = Arc::clone(&postgres_repo.list_users_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let result = handler
        .list_users(Request::new(AdminListUsersRequest {
            organization_id: Some(String::from("org-9")),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("out-of-scope organization filter must fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::PermissionDenied);
    assert_eq!(status.message(), "forbidden organization scope");
    assert!(lock_or_recover(&list_users_calls).is_empty());
}

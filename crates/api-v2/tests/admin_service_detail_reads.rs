//! Integration tests for v2 admin detail-read handler behavior.

use std::sync::Arc;

mod support;

use support::admin_service::{
    FakeAuthorizer, FakePostgresRepository, FakeRedisRepository, into_inner_or_panic,
    lock_or_recover,
};
use tearleads_api_v2::AdminServiceHandler;
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminGetGroupMembersRequest, AdminGetOrgGroupsRequest, AdminGetOrgUsersRequest,
    AdminGetOrganizationRequest, AdminGetUserRequest, admin_service_server::AdminService,
};
use tearleads_data_access_traits::{
    AdminGroupDetail, AdminGroupMember, AdminGroupSummary, AdminOrganizationSummary,
    AdminOrganizationUserSummary, AdminUserAccountingSummary, AdminUserSummary,
};
use tonic::{Code, Request};

#[tokio::test]
async fn get_group_members_returns_members_for_authorized_scope() {
    let postgres_repo = FakePostgresRepository {
        get_group_result: Ok(AdminGroupDetail {
            id: String::from("group-7"),
            organization_id: String::from("org-7"),
            name: String::from("Scoped Group"),
            description: None,
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
            members: vec![
                AdminGroupMember {
                    user_id: String::from("user-1"),
                    email: String::from("admin@example.com"),
                    joined_at: String::from("2026-01-02T00:00:00Z"),
                },
                AdminGroupMember {
                    user_id: String::from("user-2"),
                    email: String::from("member@example.com"),
                    joined_at: String::from("2026-01-03T00:00:00Z"),
                },
            ],
        }),
        ..Default::default()
    };
    let get_group_calls = Arc::clone(&postgres_repo.get_group_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let payload = into_inner_or_panic(
        handler
            .get_group_members(Request::new(AdminGetGroupMembersRequest {
                id: String::from("group-7"),
            }))
            .await,
    );

    assert_eq!(payload.members.len(), 2);
    assert_eq!(payload.members[0].user_id, "user-1");
    assert_eq!(
        lock_or_recover(&get_group_calls).clone(),
        vec![String::from("group-7")]
    );
}

#[tokio::test]
async fn get_group_members_rejects_blank_id_before_repository_calls() {
    let postgres_repo = FakePostgresRepository::default();
    let get_group_calls = Arc::clone(&postgres_repo.get_group_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_group_members(Request::new(AdminGetGroupMembersRequest {
            id: String::from(" "),
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
async fn get_group_members_rejects_forbidden_organization_scope() {
    let postgres_repo = FakePostgresRepository {
        get_group_result: Ok(AdminGroupDetail {
            id: String::from("group-9"),
            organization_id: String::from("org-9"),
            name: String::from("Other Org Group"),
            description: None,
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
            members: vec![],
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
        .get_group_members(Request::new(AdminGetGroupMembersRequest {
            id: String::from("group-9"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("group outside scope should be rejected"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::PermissionDenied);
    assert_eq!(status.message(), "forbidden organization scope");
    assert_eq!(
        lock_or_recover(&get_group_calls).clone(),
        vec![String::from("group-9")]
    );
}

#[tokio::test]
async fn get_organization_uses_scoped_filter_and_returns_detail() {
    let postgres_repo = FakePostgresRepository {
        list_organizations_result: Ok(vec![AdminOrganizationSummary {
            id: String::from("org-7"),
            name: String::from("Scoped Org"),
            description: Some(String::from("Primary")),
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
            .get_organization(Request::new(AdminGetOrganizationRequest {
                id: String::from("org-7"),
            }))
            .await,
    );
    let organization = match payload.organization {
        Some(organization) => organization,
        None => panic!("organization should be present"),
    };

    assert_eq!(organization.id, "org-7");
    assert_eq!(organization.name, "Scoped Org");
    assert_eq!(
        lock_or_recover(&list_organizations_calls).clone(),
        vec![Some(vec![String::from("org-7")])]
    );
}

#[tokio::test]
async fn get_organization_returns_not_found_when_filtered_result_is_empty() {
    let postgres_repo = FakePostgresRepository {
        list_organizations_result: Ok(vec![]),
        ..Default::default()
    };
    let list_organizations_calls = Arc::clone(&postgres_repo.list_organizations_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let result = handler
        .get_organization(Request::new(AdminGetOrganizationRequest {
            id: String::from("org-7"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("organization should be missing"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::NotFound);
    assert_eq!(status.message(), "organization not found");
    assert_eq!(
        lock_or_recover(&list_organizations_calls).clone(),
        vec![Some(vec![String::from("org-7")])]
    );
}

#[tokio::test]
async fn get_org_groups_uses_scoped_filter() {
    let postgres_repo = FakePostgresRepository {
        list_groups_result: Ok(vec![AdminGroupSummary {
            id: String::from("group-7"),
            organization_id: String::from("org-7"),
            name: String::from("Ops"),
            description: Some(String::from("Operators")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
            member_count: 3,
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
            .get_org_groups(Request::new(AdminGetOrgGroupsRequest {
                id: String::from("org-7"),
            }))
            .await,
    );

    assert_eq!(payload.groups.len(), 1);
    assert_eq!(payload.groups[0].id, "group-7");
    assert_eq!(payload.groups[0].member_count, 3);
    assert_eq!(
        lock_or_recover(&list_groups_calls).clone(),
        vec![Some(vec![String::from("org-7")])]
    );
}

#[tokio::test]
async fn get_org_users_returns_users_for_scoped_organization() {
    let postgres_repo = FakePostgresRepository {
        list_organizations_result: Ok(vec![AdminOrganizationSummary {
            id: String::from("org-7"),
            name: String::from("Scoped Org"),
            description: None,
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
        }]),
        organization_users_result: Ok(vec![AdminOrganizationUserSummary {
            id: String::from("user-1"),
            email: String::from("admin@example.com"),
            joined_at: String::from("2026-01-02T00:00:00Z"),
        }]),
        ..Default::default()
    };
    let list_organizations_calls = Arc::clone(&postgres_repo.list_organizations_calls);
    let get_organization_users_calls = Arc::clone(&postgres_repo.get_organization_users_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7"), String::from("org-9")]),
    );

    let payload = into_inner_or_panic(
        handler
            .get_org_users(Request::new(AdminGetOrgUsersRequest {
                id: String::from("org-7"),
            }))
            .await,
    );

    assert_eq!(payload.users.len(), 1);
    assert_eq!(payload.users[0].id, "user-1");
    assert_eq!(payload.users[0].email, "admin@example.com");
    assert_eq!(
        payload.users[0].joined_at,
        String::from("2026-01-02T00:00:00Z")
    );
    assert_eq!(
        lock_or_recover(&list_organizations_calls).clone(),
        vec![Some(vec![String::from("org-7")])]
    );
    assert_eq!(
        lock_or_recover(&get_organization_users_calls).clone(),
        vec![String::from("org-7")]
    );
}

#[tokio::test]
async fn get_org_users_returns_not_found_when_scope_filter_is_empty() {
    let postgres_repo = FakePostgresRepository {
        list_organizations_result: Ok(Vec::new()),
        ..Default::default()
    };
    let get_organization_users_calls = Arc::clone(&postgres_repo.get_organization_users_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let result = handler
        .get_org_users(Request::new(AdminGetOrgUsersRequest {
            id: String::from("org-7"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("organization should be missing"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::NotFound);
    assert_eq!(status.message(), "organization not found");
    assert!(lock_or_recover(&get_organization_users_calls).is_empty());
}

#[tokio::test]
async fn get_user_returns_not_found_after_scope_filter() {
    let postgres_repo = FakePostgresRepository {
        get_user_result: Ok(None),
        ..Default::default()
    };
    let get_user_calls = Arc::clone(&postgres_repo.get_user_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let result = handler
        .get_user(Request::new(AdminGetUserRequest {
            id: String::from("user-404"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("unknown user should return not-found"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::NotFound);
    assert_eq!(status.message(), "user not found");
    assert_eq!(
        lock_or_recover(&get_user_calls).clone(),
        vec![(String::from("user-404"), Some(vec![String::from("org-7")]),)]
    );
}

#[tokio::test]
async fn get_user_returns_user_for_root_admin_without_scope_filter() {
    let postgres_repo = FakePostgresRepository {
        get_user_result: Ok(Some(AdminUserSummary {
            id: String::from("user-1"),
            email: String::from("admin@example.com"),
            email_confirmed: true,
            admin: true,
            organization_ids: vec![String::from("org-7")],
            created_at: Some(String::from("2026-01-01T00:00:00Z")),
            last_active_at: Some(String::from("2026-01-02T00:00:00Z")),
            accounting: AdminUserAccountingSummary {
                total_prompt_tokens: 1,
                total_completion_tokens: 2,
                total_tokens: 3,
                request_count: 4,
                last_used_at: Some(String::from("2026-01-03T00:00:00Z")),
            },
            disabled: false,
            disabled_at: None,
            disabled_by: None,
            marked_for_deletion_at: None,
            marked_for_deletion_by: None,
        })),
        ..Default::default()
    };
    let get_user_calls = Arc::clone(&postgres_repo.get_user_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .get_user(Request::new(AdminGetUserRequest {
                id: String::from("user-1"),
            }))
            .await,
    );
    let user = match payload.user {
        Some(user) => user,
        None => panic!("user should be present"),
    };

    assert_eq!(user.id, "user-1");
    assert_eq!(user.email, "admin@example.com");
    assert_eq!(user.organization_ids, vec![String::from("org-7")]);
    assert_eq!(
        lock_or_recover(&get_user_calls).clone(),
        vec![(String::from("user-1"), None)]
    );
}

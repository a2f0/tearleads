//! Integration tests for v2 admin group mutation handlers.

use std::sync::Arc;

#[path = "admin_service_group_mutations/guards.rs"]
mod guards;
mod support;

use support::admin_service::{
    FakeAuthorizer, FakePostgresGateway, FakeRedisRepository, into_inner_or_panic,
    lock_or_recover,
};
use tearleads_api_v2::AdminServiceHandler;
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminAddGroupMemberRequest, AdminCreateGroupRequest, AdminRemoveGroupMemberRequest,
    AdminUpdateGroupRequest, admin_service_server::AdminService,
};
use tearleads_data_access_traits::{
    AdminCreateGroupInput, AdminGroupDetail, AdminUpdateGroupInput,
};
use tonic::{Code, Request};

#[tokio::test]
async fn create_group_accepts_scoped_admin_for_authorized_organization() {
    let postgres_repo = FakePostgresGateway {
        create_group_result: Ok(AdminGroupDetail {
            id: String::from("group-created"),
            organization_id: String::from("org-7"),
            name: String::from("Created Group"),
            description: Some(String::from("Created description")),
            created_at: String::from("2026-01-10T00:00:00Z"),
            updated_at: String::from("2026-01-10T00:00:00Z"),
            members: vec![],
        }),
        ..Default::default()
    };
    let create_group_calls = Arc::clone(&postgres_repo.create_group_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let payload = into_inner_or_panic(
        handler
            .create_group(Request::new(AdminCreateGroupRequest {
                organization_id: String::from(" org-7 "),
                name: String::from(" Created Group "),
                description: Some(String::from(" Created description ")),
            }))
            .await,
    );

    let group = match payload.group {
        Some(group) => group,
        None => panic!("group should be present"),
    };
    assert_eq!(group.id, "group-created");
    assert_eq!(group.organization_id, "org-7");
    assert_eq!(group.name, "Created Group");
    assert_eq!(group.description.as_deref(), Some("Created description"));
    assert_eq!(
        lock_or_recover(&create_group_calls).clone(),
        vec![AdminCreateGroupInput {
            organization_id: String::from("org-7"),
            name: String::from("Created Group"),
            description: Some(String::from("Created description")),
        }]
    );
}

#[tokio::test]
async fn create_group_rejects_scoped_admin_forbidden_organization() {
    let postgres_repo = FakePostgresGateway::default();
    let create_group_calls = Arc::clone(&postgres_repo.create_group_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let result = handler
        .create_group(Request::new(AdminCreateGroupRequest {
            organization_id: String::from("org-9"),
            name: String::from("Created Group"),
            description: None,
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("create_group outside scoped org should fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::PermissionDenied);
    assert_eq!(status.message(), "forbidden organization scope");
    assert!(lock_or_recover(&create_group_calls).is_empty());
}

#[tokio::test]
async fn create_group_trims_blank_description_to_none() {
    let postgres_repo = FakePostgresGateway {
        create_group_result: Ok(AdminGroupDetail {
            id: String::from("group-created"),
            organization_id: String::from("org-7"),
            name: String::from("Created Group"),
            description: None,
            created_at: String::from("2026-01-10T00:00:00Z"),
            updated_at: String::from("2026-01-10T00:00:00Z"),
            members: vec![],
        }),
        ..Default::default()
    };
    let create_group_calls = Arc::clone(&postgres_repo.create_group_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let _payload = into_inner_or_panic(
        handler
            .create_group(Request::new(AdminCreateGroupRequest {
                organization_id: String::from("org-7"),
                name: String::from("Created Group"),
                description: Some(String::from("   ")),
            }))
            .await,
    );

    assert_eq!(
        lock_or_recover(&create_group_calls).clone(),
        vec![AdminCreateGroupInput {
            organization_id: String::from("org-7"),
            name: String::from("Created Group"),
            description: None,
        }]
    );
}

#[tokio::test]
async fn update_group_translates_optional_patch_fields() {
    let postgres_repo = FakePostgresGateway {
        get_group_result: Ok(AdminGroupDetail {
            id: String::from("group-1"),
            organization_id: String::from("org-7"),
            name: String::from("Current Name"),
            description: Some(String::from("Current Description")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-02T00:00:00Z"),
            members: vec![],
        }),
        update_group_result: Ok(AdminGroupDetail {
            id: String::from("group-1"),
            organization_id: String::from("org-7"),
            name: String::from("Renamed Group"),
            description: None,
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-03T00:00:00Z"),
            members: vec![],
        }),
        ..Default::default()
    };
    let update_group_calls = Arc::clone(&postgres_repo.update_group_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let payload = into_inner_or_panic(
        handler
            .update_group(Request::new(AdminUpdateGroupRequest {
                id: String::from("group-1"),
                organization_id: None,
                name: Some(String::from(" Renamed Group ")),
                description: Some(String::from("   ")),
            }))
            .await,
    );

    let group = match payload.group {
        Some(group) => group,
        None => panic!("group should be present"),
    };
    assert_eq!(group.id, "group-1");
    assert_eq!(group.name, "Renamed Group");
    assert_eq!(group.description, None);
    assert_eq!(
        lock_or_recover(&update_group_calls).clone(),
        vec![(
            String::from("group-1"),
            AdminUpdateGroupInput {
                name: Some(String::from("Renamed Group")),
                organization_id: None,
                description: Some(None),
            }
        )]
    );
}

#[tokio::test]
async fn add_group_member_rejects_blank_user_id_before_repository_calls() {
    let postgres_repo = FakePostgresGateway {
        get_group_result: Ok(AdminGroupDetail {
            id: String::from("group-1"),
            organization_id: String::from("org-7"),
            name: String::from("Core Admin"),
            description: None,
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
            members: vec![],
        }),
        ..Default::default()
    };
    let get_group_calls = Arc::clone(&postgres_repo.get_group_calls);
    let add_member_calls = Arc::clone(&postgres_repo.add_group_member_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .add_group_member(Request::new(AdminAddGroupMemberRequest {
            id: String::from("group-1"),
            user_id: String::from("   "),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("blank user_id should fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(status.message(), "user_id must not be empty");
    assert!(lock_or_recover(&get_group_calls).is_empty());
    assert!(lock_or_recover(&add_member_calls).is_empty());
}

#[tokio::test]
async fn remove_group_member_returns_repository_boolean() {
    let postgres_repo = FakePostgresGateway {
        get_group_result: Ok(AdminGroupDetail {
            id: String::from("group-1"),
            organization_id: String::from("org-1"),
            name: String::from("Core Admin"),
            description: None,
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
            members: vec![],
        }),
        remove_group_member_result: Ok(false),
        ..Default::default()
    };
    let remove_group_member_calls = Arc::clone(&postgres_repo.remove_group_member_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .remove_group_member(Request::new(AdminRemoveGroupMemberRequest {
                group_id: String::from("group-1"),
                user_id: String::from("user-2"),
            }))
            .await,
    );

    assert!(!payload.removed);
    assert_eq!(
        lock_or_recover(&remove_group_member_calls).clone(),
        vec![(String::from("group-1"), String::from("user-2"))]
    );
}

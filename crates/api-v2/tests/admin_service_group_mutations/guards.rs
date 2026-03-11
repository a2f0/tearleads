use std::sync::Arc;

use super::support::admin_service::{
    FakeAuthorizer, FakePostgresGateway, FakeRedisRepository, into_inner_or_panic, lock_or_recover,
};
use tearleads_api_v2::AdminServiceHandler;
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminAddGroupMemberRequest, AdminDeleteGroupRequest, AdminRemoveGroupMemberRequest,
    AdminUpdateGroupRequest, admin_service_server::AdminService,
};
use tearleads_data_access_traits::{
    AdminGroupDetail, AdminUpdateGroupInput, DataAccessError, DataAccessErrorKind,
};
use tonic::{Code, Request};

#[tokio::test]
async fn update_group_rejects_forbidden_current_group_scope() {
    let postgres_repo = FakePostgresGateway {
        get_group_result: Ok(AdminGroupDetail {
            id: String::from("group-1"),
            organization_id: String::from("org-9"),
            name: String::from("Current Name"),
            description: Some(String::from("Current Description")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-02T00:00:00Z"),
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

    let result = handler
        .update_group(Request::new(AdminUpdateGroupRequest {
            id: String::from("group-1"),
            organization_id: Some(String::from("org-9")),
            name: Some(String::from("Renamed Group")),
            description: None,
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("update should fail for forbidden current scope"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::PermissionDenied);
    assert_eq!(status.message(), "forbidden organization scope");
    assert!(lock_or_recover(&update_group_calls).is_empty());
}

#[tokio::test]
async fn update_group_rejects_target_organization_outside_scope() {
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
        ..Default::default()
    };
    let update_group_calls = Arc::clone(&postgres_repo.update_group_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let result = handler
        .update_group(Request::new(AdminUpdateGroupRequest {
            id: String::from("group-1"),
            organization_id: Some(String::from("org-9")),
            name: Some(String::from("Renamed Group")),
            description: None,
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("update should fail for forbidden target organization"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::PermissionDenied);
    assert_eq!(status.message(), "forbidden organization scope");
    assert!(lock_or_recover(&update_group_calls).is_empty());
}

#[tokio::test]
async fn update_group_rejects_no_fields_to_update() {
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
        ..Default::default()
    };
    let update_group_calls = Arc::clone(&postgres_repo.update_group_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let result = handler
        .update_group(Request::new(AdminUpdateGroupRequest {
            id: String::from("group-1"),
            organization_id: None,
            name: None,
            description: None,
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("update with no fields should fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(status.message(), "no fields to update");
    assert!(lock_or_recover(&update_group_calls).is_empty());
}

#[tokio::test]
async fn update_group_trims_non_empty_description() {
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
            name: String::from("Current Name"),
            description: Some(String::from("Updated description")),
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

    let _payload = into_inner_or_panic(
        handler
            .update_group(Request::new(AdminUpdateGroupRequest {
                id: String::from("group-1"),
                organization_id: None,
                name: None,
                description: Some(String::from(" Updated description ")),
            }))
            .await,
    );

    assert_eq!(
        lock_or_recover(&update_group_calls).clone(),
        vec![(
            String::from("group-1"),
            AdminUpdateGroupInput {
                name: None,
                organization_id: None,
                description: Some(Some(String::from("Updated description"))),
            }
        )]
    );
}

#[tokio::test]
async fn delete_group_routes_through_repository_for_authorized_scope() {
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
        delete_group_result: Ok(true),
        ..Default::default()
    };
    let get_group_calls = Arc::clone(&postgres_repo.get_group_calls);
    let delete_group_calls = Arc::clone(&postgres_repo.delete_group_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let payload = into_inner_or_panic(
        handler
            .delete_group(Request::new(AdminDeleteGroupRequest {
                id: String::from("group-1"),
            }))
            .await,
    );

    assert!(payload.deleted);
    assert_eq!(
        lock_or_recover(&get_group_calls).clone(),
        vec![String::from("group-1")]
    );
    assert_eq!(
        lock_or_recover(&delete_group_calls).clone(),
        vec![String::from("group-1")]
    );
}

#[tokio::test]
async fn delete_group_rejects_forbidden_scope() {
    let postgres_repo = FakePostgresGateway {
        get_group_result: Ok(AdminGroupDetail {
            id: String::from("group-1"),
            organization_id: String::from("org-9"),
            name: String::from("Current Name"),
            description: Some(String::from("Current Description")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-02T00:00:00Z"),
            members: vec![],
        }),
        delete_group_result: Ok(true),
        ..Default::default()
    };
    let delete_group_calls = Arc::clone(&postgres_repo.delete_group_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let result = handler
        .delete_group(Request::new(AdminDeleteGroupRequest {
            id: String::from("group-1"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("delete_group outside scope should fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::PermissionDenied);
    assert_eq!(status.message(), "forbidden organization scope");
    assert!(lock_or_recover(&delete_group_calls).is_empty());
}

#[tokio::test]
async fn add_group_member_returns_repository_boolean_for_authorized_scope() {
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
        add_group_member_result: Ok(true),
        ..Default::default()
    };
    let get_group_calls = Arc::clone(&postgres_repo.get_group_calls);
    let add_member_calls = Arc::clone(&postgres_repo.add_group_member_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let payload = into_inner_or_panic(
        handler
            .add_group_member(Request::new(AdminAddGroupMemberRequest {
                id: String::from("group-1"),
                user_id: String::from("user-8"),
            }))
            .await,
    );

    assert!(payload.added);
    assert_eq!(
        lock_or_recover(&get_group_calls).clone(),
        vec![String::from("group-1")]
    );
    assert_eq!(
        lock_or_recover(&add_member_calls).clone(),
        vec![(String::from("group-1"), String::from("user-8"))]
    );
}

#[tokio::test]
async fn add_group_member_rejects_forbidden_scope() {
    let postgres_repo = FakePostgresGateway {
        get_group_result: Ok(AdminGroupDetail {
            id: String::from("group-1"),
            organization_id: String::from("org-9"),
            name: String::from("Core Admin"),
            description: None,
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
            members: vec![],
        }),
        add_group_member_result: Ok(true),
        ..Default::default()
    };
    let add_member_calls = Arc::clone(&postgres_repo.add_group_member_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let result = handler
        .add_group_member(Request::new(AdminAddGroupMemberRequest {
            id: String::from("group-1"),
            user_id: String::from("user-8"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("add_group_member outside scope should fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::PermissionDenied);
    assert_eq!(status.message(), "forbidden organization scope");
    assert!(lock_or_recover(&add_member_calls).is_empty());
}

#[tokio::test]
async fn add_group_member_maps_repository_errors() {
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
        add_group_member_result: Err(DataAccessError::new(
            DataAccessErrorKind::NotFound,
            "user missing",
        )),
        ..Default::default()
    };
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let result = handler
        .add_group_member(Request::new(AdminAddGroupMemberRequest {
            id: String::from("group-1"),
            user_id: String::from("user-missing"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("repository error should map to gRPC status"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::NotFound);
    assert_eq!(status.message(), "user missing");
}

#[tokio::test]
async fn remove_group_member_rejects_forbidden_scope() {
    let postgres_repo = FakePostgresGateway {
        get_group_result: Ok(AdminGroupDetail {
            id: String::from("group-1"),
            organization_id: String::from("org-9"),
            name: String::from("Core Admin"),
            description: None,
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
            members: vec![],
        }),
        ..Default::default()
    };
    let remove_group_member_calls = Arc::clone(&postgres_repo.remove_group_member_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7")]),
    );

    let result = handler
        .remove_group_member(Request::new(AdminRemoveGroupMemberRequest {
            group_id: String::from("group-1"),
            user_id: String::from("user-2"),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("remove_group_member outside scope should fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::PermissionDenied);
    assert_eq!(status.message(), "forbidden organization scope");
    assert!(lock_or_recover(&remove_group_member_calls).is_empty());
}

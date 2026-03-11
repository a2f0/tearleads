//! Integration tests for v2 admin organization/user mutation handlers.

use std::sync::Arc;

mod support;

use support::admin_service::{
    FakeAuthorizer, FakePostgresGateway, FakeRedisRepository, into_inner_or_panic,
    lock_or_recover,
};
use tearleads_api_v2::AdminServiceHandler;
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminCreateOrganizationRequest, AdminDeleteOrganizationRequest, AdminUpdateOrganizationRequest,
    AdminUpdateUserOrganizationIds, AdminUpdateUserRequest, admin_service_server::AdminService,
};
use tearleads_data_access_traits::{
    AdminCreateOrganizationInput, AdminOrganizationSummary, AdminUpdateOrganizationInput,
    AdminUpdateUserInput, AdminUserAccountingSummary, AdminUserSummary, DataAccessError,
    DataAccessErrorKind,
};
use tonic::{Code, Request};

fn sample_user_summary() -> AdminUserSummary {
    AdminUserSummary {
        id: String::from("user-1"),
        email: String::from("admin@example.com"),
        email_confirmed: true,
        admin: true,
        organization_ids: vec![String::from("org-1")],
        created_at: Some(String::from("2026-01-01T00:00:00Z")),
        last_active_at: Some(String::from("2026-01-02T00:00:00Z")),
        accounting: AdminUserAccountingSummary {
            total_prompt_tokens: 1,
            total_completion_tokens: 2,
            total_tokens: 3,
            request_count: 4,
            last_used_at: Some(String::from("2026-01-02T00:00:00Z")),
        },
        disabled: false,
        disabled_at: None,
        disabled_by: None,
        marked_for_deletion_at: None,
        marked_for_deletion_by: None,
    }
}

#[tokio::test]
async fn create_organization_trims_fields_and_maps_response() {
    let postgres_repo = FakePostgresGateway {
        create_organization_result: Ok(AdminOrganizationSummary {
            id: String::from("org-created"),
            name: String::from("Org Created"),
            description: Some(String::from("Created description")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
        }),
        ..Default::default()
    };
    let create_calls = Arc::clone(&postgres_repo.create_organization_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .create_organization(Request::new(AdminCreateOrganizationRequest {
                name: String::from(" Org Created "),
                description: Some(String::from(" Created description ")),
            }))
            .await,
    );

    let organization = match payload.organization {
        Some(organization) => organization,
        None => panic!("organization should be present"),
    };
    assert_eq!(organization.id, "org-created");
    assert_eq!(organization.name, "Org Created");
    assert_eq!(
        organization.description.as_deref(),
        Some("Created description")
    );
    assert_eq!(
        lock_or_recover(&create_calls).clone(),
        vec![AdminCreateOrganizationInput {
            name: String::from("Org Created"),
            description: Some(String::from("Created description")),
        }]
    );
}

#[tokio::test]
async fn create_organization_maps_data_access_error() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresGateway {
            create_organization_result: Err(DataAccessError::new(
                DataAccessErrorKind::InvalidInput,
                "organization name already exists",
            )),
            ..Default::default()
        },
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .create_organization(Request::new(AdminCreateOrganizationRequest {
            name: String::from("Org"),
            description: None,
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("duplicate organization should fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(status.message(), "organization name already exists");
}

#[tokio::test]
async fn update_organization_translates_patch_fields() {
    let postgres_repo = FakePostgresGateway {
        update_organization_result: Ok(AdminOrganizationSummary {
            id: String::from("org-1"),
            name: String::from("Renamed"),
            description: None,
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-03T00:00:00Z"),
        }),
        ..Default::default()
    };
    let update_calls = Arc::clone(&postgres_repo.update_organization_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .update_organization(Request::new(AdminUpdateOrganizationRequest {
                id: String::from("org-1"),
                name: Some(String::from(" Renamed ")),
                description: Some(String::from("   ")),
            }))
            .await,
    );

    let organization = match payload.organization {
        Some(organization) => organization,
        None => panic!("organization should be present"),
    };
    assert_eq!(organization.id, "org-1");
    assert_eq!(organization.name, "Renamed");
    assert_eq!(organization.description, None);
    assert_eq!(
        lock_or_recover(&update_calls).clone(),
        vec![(
            String::from("org-1"),
            AdminUpdateOrganizationInput {
                name: Some(String::from("Renamed")),
                description: Some(None),
            }
        )]
    );
}

#[tokio::test]
async fn update_organization_rejects_empty_patch() {
    let postgres_repo = FakePostgresGateway::default();
    let update_calls = Arc::clone(&postgres_repo.update_organization_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .update_organization(Request::new(AdminUpdateOrganizationRequest {
            id: String::from("org-1"),
            name: None,
            description: None,
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("empty patch should fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(status.message(), "no fields to update");
    assert!(lock_or_recover(&update_calls).is_empty());
}

#[tokio::test]
async fn delete_organization_returns_repository_boolean() {
    let postgres_repo = FakePostgresGateway {
        delete_organization_result: Ok(false),
        ..Default::default()
    };
    let delete_calls = Arc::clone(&postgres_repo.delete_organization_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .delete_organization(Request::new(AdminDeleteOrganizationRequest {
                id: String::from("org-missing"),
            }))
            .await,
    );

    assert!(!payload.deleted);
    assert_eq!(
        lock_or_recover(&delete_calls).clone(),
        vec![String::from("org-missing")]
    );
}

#[tokio::test]
async fn update_user_translates_payload_and_maps_response() {
    let mut updated_user = sample_user_summary();
    updated_user.organization_ids = vec![String::from("org-1"), String::from("org-2")];
    let postgres_repo = FakePostgresGateway {
        update_user_result: Ok(updated_user),
        ..Default::default()
    };
    let update_calls = Arc::clone(&postgres_repo.update_user_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .update_user(Request::new(AdminUpdateUserRequest {
                id: String::from("user-1"),
                email: Some(String::from(" updated@example.com ")),
                email_confirmed: Some(true),
                admin: Some(false),
                organization_ids: Some(AdminUpdateUserOrganizationIds {
                    organization_ids: vec![String::from("org-1"), String::from("org-2")],
                }),
                disabled: Some(false),
                marked_for_deletion: Some(true),
            }))
            .await,
    );

    let user = match payload.user {
        Some(user) => user,
        None => panic!("user should be present"),
    };
    assert_eq!(user.id, "user-1");
    assert_eq!(user.organization_ids, vec!["org-1", "org-2"]);
    assert_eq!(
        lock_or_recover(&update_calls).clone(),
        vec![(
            String::from("user-1"),
            AdminUpdateUserInput {
                email: Some(String::from("updated@example.com")),
                email_confirmed: Some(true),
                admin: Some(false),
                organization_ids: Some(vec![String::from("org-1"), String::from("org-2")]),
                disabled: Some(false),
                marked_for_deletion: Some(true),
            }
        )]
    );
}

#[tokio::test]
async fn update_user_rejects_empty_patch() {
    let postgres_repo = FakePostgresGateway::default();
    let update_calls = Arc::clone(&postgres_repo.update_user_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .update_user(Request::new(AdminUpdateUserRequest {
            id: String::from("user-1"),
            email: None,
            email_confirmed: None,
            admin: None,
            organization_ids: None,
            disabled: None,
            marked_for_deletion: None,
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("empty update should fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(status.message(), "no fields to update");
    assert!(lock_or_recover(&update_calls).is_empty());
}

#[tokio::test]
async fn update_user_rejects_blank_organization_ids_before_repository_call() {
    let postgres_repo = FakePostgresGateway::default();
    let update_calls = Arc::clone(&postgres_repo.update_user_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .update_user(Request::new(AdminUpdateUserRequest {
            id: String::from("user-1"),
            email: None,
            email_confirmed: None,
            admin: None,
            organization_ids: Some(AdminUpdateUserOrganizationIds {
                organization_ids: vec![String::from(" org-1 "), String::from("   ")],
            }),
            disabled: None,
            marked_for_deletion: None,
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("blank organization id should fail"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(status.message(), "organization_ids must not be empty");
    assert!(lock_or_recover(&update_calls).is_empty());
}

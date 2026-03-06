//! Integration tests for the v2 admin service context endpoint.

use std::sync::Arc;

// support module provided by parent test crate

use super::support::admin_service::{
    FakeAuthorizer, FakePostgresRepository, FakeRedisRepository, into_inner_or_panic,
    lock_or_recover,
};
use tearleads_api_v2::AdminServiceHandler;
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminGetContextRequest, admin_service_server::AdminService,
};
use tearleads_data_access_traits::AdminScopeOrganization;
use tonic::{Code, Request};

#[tokio::test]
async fn get_context_for_root_admin_uses_unfiltered_organizations() {
    let postgres_repo = FakePostgresRepository {
        scope_organizations_result: Ok(vec![
            AdminScopeOrganization {
                id: String::from("org-1"),
                name: String::from("Alpha"),
            },
            AdminScopeOrganization {
                id: String::from("org-2"),
                name: String::from("Beta"),
            },
        ]),
        ..Default::default()
    };
    let scoped_calls = Arc::clone(&postgres_repo.scope_organizations_by_ids_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .get_context(Request::new(AdminGetContextRequest {}))
            .await,
    );

    assert!(payload.is_root_admin);
    assert_eq!(payload.default_organization_id, None);
    assert_eq!(payload.organizations.len(), 2);
    assert_eq!(payload.organizations[0].id, "org-1");
    assert_eq!(payload.organizations[0].name, "Alpha");
    assert_eq!(payload.organizations[1].id, "org-2");
    assert_eq!(payload.organizations[1].name, "Beta");
    assert!(lock_or_recover(&scoped_calls).is_empty());
}

#[tokio::test]
async fn get_context_for_scoped_admin_uses_filtered_organizations_and_default() {
    let postgres_repo = FakePostgresRepository {
        scope_organizations_by_ids_result: Ok(vec![AdminScopeOrganization {
            id: String::from("org-7"),
            name: String::from("Gamma"),
        }]),
        ..Default::default()
    };
    let scoped_calls = Arc::clone(&postgres_repo.scope_organizations_by_ids_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_scoped(vec![String::from("org-7"), String::from("org-9")]),
    );

    let payload = into_inner_or_panic(
        handler
            .get_context(Request::new(AdminGetContextRequest {}))
            .await,
    );

    assert!(!payload.is_root_admin);
    assert_eq!(payload.default_organization_id.as_deref(), Some("org-7"));
    assert_eq!(payload.organizations.len(), 1);
    assert_eq!(payload.organizations[0].id, "org-7");
    assert_eq!(payload.organizations[0].name, "Gamma");
    assert_eq!(
        lock_or_recover(&scoped_calls).clone(),
        vec![vec![String::from("org-7"), String::from("org-9")]]
    );
}

#[tokio::test]
async fn get_context_maps_authorizer_denials() {
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresRepository::default(),
        FakeRedisRepository::default(),
        FakeAuthorizer::deny(
            tearleads_api_v2::AdminAuthErrorKind::PermissionDenied,
            "denied",
        ),
    );

    let result = handler
        .get_context(Request::new(AdminGetContextRequest {}))
        .await;
    let status = match result {
        Ok(_) => panic!("get_context should fail when authorizer denies access"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::PermissionDenied);
    assert_eq!(status.message(), "denied");
}

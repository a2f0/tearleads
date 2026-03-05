//! Integration tests for v2 admin list-groups handler behavior.

use std::sync::Arc;

mod support;

use support::admin_service::{
    FakeAuthorizer, FakePostgresRepository, FakeRedisRepository, into_inner_or_panic,
    lock_or_recover,
};
use tearleads_api_v2::AdminServiceHandler;
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminListGroupsRequest, admin_service_server::AdminService,
};
use tearleads_data_access_traits::AdminGroupSummary;
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

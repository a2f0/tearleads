use futures::executor::block_on;
use tearleads_data_access_traits::{
    AdminUserAccountingSummary, AdminUserSummary, PostgresAdminReadRepository,
};

use super::{AdminUserAccountingRecord, AdminUserRecord, FakeGateway, PostgresAdminReadAdapter};

#[test]
fn get_user_forwards_identifier_and_optional_scope_filter() {
    let gateway = FakeGateway {
        get_user_result: Ok(Some(AdminUserRecord {
            id: String::from("user-7"),
            email: String::from("scoped@example.com"),
            email_confirmed: true,
            admin: false,
            organization_ids: vec![String::from("org-2")],
            created_at: Some(String::from("2026-01-01T00:00:00Z")),
            last_active_at: None,
            accounting: AdminUserAccountingRecord::default(),
            disabled: false,
            disabled_at: None,
            disabled_by: None,
            marked_for_deletion_at: None,
            marked_for_deletion_by: None,
        })),
        ..Default::default()
    };
    let adapter = PostgresAdminReadAdapter::new(gateway);

    let filtered_result = block_on(adapter.get_user(
        "user-7",
        Some(vec![String::from("org-2"), String::from("org-9")]),
    ));
    let filtered_user = match filtered_result {
        Ok(Some(value)) => value,
        Ok(None) => panic!("user should be present"),
        Err(error) => panic!("filtered get_user should succeed, got: {error}"),
    };
    assert_eq!(
        filtered_user,
        AdminUserSummary {
            id: String::from("user-7"),
            email: String::from("scoped@example.com"),
            email_confirmed: true,
            admin: false,
            organization_ids: vec![String::from("org-2")],
            created_at: Some(String::from("2026-01-01T00:00:00Z")),
            last_active_at: None,
            accounting: AdminUserAccountingSummary::default(),
            disabled: false,
            disabled_at: None,
            disabled_by: None,
            marked_for_deletion_at: None,
            marked_for_deletion_by: None,
        }
    );

    let unfiltered_result = block_on(adapter.get_user("user-7", None));
    if let Err(error) = unfiltered_result {
        panic!("unfiltered get_user should succeed, got: {error}");
    }

    assert_eq!(
        adapter.gateway.get_user_calls(),
        vec![
            (
                String::from("user-7"),
                Some(vec![String::from("org-2"), String::from("org-9")]),
            ),
            (String::from("user-7"), None),
        ]
    );
}

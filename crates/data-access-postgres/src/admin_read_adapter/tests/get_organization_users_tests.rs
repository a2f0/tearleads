use futures::executor::block_on;
use tearleads_data_access_traits::{AdminOrganizationUserSummary, PostgresAdminReadRepository};

use super::{AdminOrganizationUserRecord, FakeGateway, PostgresAdminReadAdapter};

#[test]
fn get_organization_users_maps_gateway_rows() {
    let gateway = FakeGateway {
        organization_users_result: Ok(vec![
            AdminOrganizationUserRecord {
                id: String::from("user-1"),
                email: String::from("admin@example.com"),
                joined_at: String::from("2026-01-01T00:00:00Z"),
            },
            AdminOrganizationUserRecord {
                id: String::from("user-2"),
                email: String::from("member@example.com"),
                joined_at: String::from("2026-01-02T00:00:00Z"),
            },
        ]),
        ..Default::default()
    };
    let adapter = PostgresAdminReadAdapter::new(gateway);

    let result = block_on(adapter.get_organization_users("org-1"));
    let users = match result {
        Ok(value) => value,
        Err(error) => panic!("organization users query should succeed, got: {error}"),
    };

    assert_eq!(
        users,
        vec![
            AdminOrganizationUserSummary {
                id: String::from("user-1"),
                email: String::from("admin@example.com"),
                joined_at: String::from("2026-01-01T00:00:00Z"),
            },
            AdminOrganizationUserSummary {
                id: String::from("user-2"),
                email: String::from("member@example.com"),
                joined_at: String::from("2026-01-02T00:00:00Z"),
            },
        ]
    );
}

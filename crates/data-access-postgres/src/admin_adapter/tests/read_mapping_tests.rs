use super::*;

#[test]
fn postgres_info_uses_gateway_connection_and_version() {
    let gateway = FakeGateway {
        connection_info: PostgresConnectionInfo {
            host: Some(String::from("localhost")),
            port: Some(5432),
            database: Some(String::from("tearleads")),
            user: Some(String::from("tearleads")),
        },
        server_version_result: Ok(Some(String::from("PostgreSQL 16.3"))),
        ..Default::default()
    };

    let adapter = PostgresAdminAdapter::new(gateway);
    let result = block_on(adapter.get_postgres_info());
    let snapshot = match result {
        Ok(value) => value,
        Err(error) => panic!("postgres info should succeed, got: {error}"),
    };

    assert_eq!(snapshot.connection.host.as_deref(), Some("localhost"));
    assert_eq!(snapshot.connection.port, Some(5432));
    assert_eq!(snapshot.connection.database.as_deref(), Some("tearleads"));
    assert_eq!(snapshot.connection.user.as_deref(), Some("tearleads"));
    assert_eq!(snapshot.server_version.as_deref(), Some("PostgreSQL 16.3"));
}

#[test]
fn list_tables_maps_gateway_rows() {
    let gateway = FakeGateway {
        tables_result: Ok(vec![PostgresTableRecord {
            schema: String::from("public"),
            name: String::from("users"),
            row_count: 10,
            total_bytes: 2048,
            table_bytes: 1024,
            index_bytes: 1024,
        }]),
        ..Default::default()
    };

    let adapter = PostgresAdminAdapter::new(gateway);
    let result = block_on(adapter.list_tables());
    let tables = match result {
        Ok(value) => value,
        Err(error) => panic!("table listing should succeed, got: {error}"),
    };

    assert_eq!(
        tables,
        vec![PostgresTableInfo {
            schema: String::from("public"),
            name: String::from("users"),
            row_count: 10,
            total_bytes: 2048,
            table_bytes: 1024,
            index_bytes: 1024,
        }]
    );
}

#[test]
fn list_scope_organizations_maps_gateway_rows() {
    let gateway = FakeGateway {
        scope_organizations_result: Ok(vec![AdminScopeOrganizationRecord {
            id: String::from("org-1"),
            name: String::from("Alpha"),
        }]),
        ..Default::default()
    };

    let adapter = PostgresAdminAdapter::new(gateway);
    let result = block_on(adapter.list_scope_organizations());
    let organizations = match result {
        Ok(value) => value,
        Err(error) => panic!("scope organization listing should succeed, got: {error}"),
    };

    assert_eq!(
        organizations,
        vec![AdminScopeOrganization {
            id: String::from("org-1"),
            name: String::from("Alpha"),
        }]
    );
    assert_eq!(adapter.gateway.list_scope_organizations_calls(), 1);
}

#[test]
fn list_scope_organizations_by_ids_forwards_ids_and_maps_gateway_rows() {
    let gateway = FakeGateway {
        scoped_organizations_by_ids_result: Ok(vec![AdminScopeOrganizationRecord {
            id: String::from("org-2"),
            name: String::from("Beta"),
        }]),
        ..Default::default()
    };
    let adapter = PostgresAdminAdapter::new(gateway);

    let result = block_on(
        adapter.list_scope_organizations_by_ids(vec![String::from("org-2"), String::from("org-1")]),
    );
    let organizations = match result {
        Ok(value) => value,
        Err(error) => panic!("scoped organization listing should succeed, got: {error}"),
    };

    assert_eq!(
        organizations,
        vec![AdminScopeOrganization {
            id: String::from("org-2"),
            name: String::from("Beta"),
        }]
    );
    assert_eq!(
        adapter.gateway.list_scope_organizations_by_ids_calls(),
        vec![vec![String::from("org-2"), String::from("org-1")]]
    );
}

#[test]
fn list_groups_forwards_optional_filters_and_maps_gateway_rows() {
    let gateway = FakeGateway {
        groups_result: Ok(vec![AdminGroupSummaryRecord {
            id: String::from("group-1"),
            organization_id: String::from("org-2"),
            name: String::from("Ops"),
            description: Some(String::from("Operators")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-02T00:00:00Z"),
            member_count: 3,
        }]),
        ..Default::default()
    };
    let adapter = PostgresAdminAdapter::new(gateway);

    let filtered_result = block_on(adapter.list_groups(Some(vec![String::from("org-2")])));
    let filtered_groups = match filtered_result {
        Ok(value) => value,
        Err(error) => panic!("filtered list_groups should succeed, got: {error}"),
    };
    assert_eq!(
        filtered_groups,
        vec![AdminGroupSummary {
            id: String::from("group-1"),
            organization_id: String::from("org-2"),
            name: String::from("Ops"),
            description: Some(String::from("Operators")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-02T00:00:00Z"),
            member_count: 3,
        }]
    );

    let unfiltered_result = block_on(adapter.list_groups(None));
    if let Err(error) = unfiltered_result {
        panic!("unfiltered list_groups should succeed, got: {error}");
    }

    assert_eq!(
        adapter.gateway.list_groups_calls(),
        vec![Some(vec![String::from("org-2")]), None]
    );
}

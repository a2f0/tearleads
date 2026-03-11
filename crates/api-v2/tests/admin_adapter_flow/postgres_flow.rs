use super::*;

#[tokio::test]
async fn postgres_info_and_tables_flow_through_adapter_and_gateway() {
    let postgres_gateway = FakePostgresGateway {
        connection_info: PostgresConnectionInfo {
            host: Some(String::from("localhost")),
            port: Some(5432),
            database: Some(String::from("tearleads")),
            user: Some(String::from("tearleads")),
        },
        server_version: Some(String::from("PostgreSQL 16.7")),
        tables: vec![PostgresTableRecord {
            schema: String::from("public"),
            name: String::from("users"),
            row_count: 9,
            total_bytes: 1000,
            table_bytes: 600,
            index_bytes: 400,
        }],
        rows_page: PostgresRowsPageRecord {
            rows_json: vec![String::from("{\"id\":\"user-1\"}")],
            total_count: 1,
            limit: 10,
            offset: 20,
        },
        ..Default::default()
    };
    let postgres_calls = Arc::clone(&postgres_gateway.calls);
    let handler = AdminServiceHandler::new(
        PostgresAdminAdapter::new(postgres_gateway),
        RedisAdminAdapter::new(FakeRedisGateway::default()),
    );

    let info_response = match handler
        .get_postgres_info(admin_request(AdminGetPostgresInfoRequest {}))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_postgres_info should succeed: {error}"),
    };
    assert_eq!(
        info_response
            .info
            .as_ref()
            .and_then(|value| value.host.clone()),
        Some(String::from("localhost"))
    );
    assert_eq!(
        info_response.server_version.as_deref(),
        Some("PostgreSQL 16.7")
    );

    let tables_response = match handler
        .get_tables(admin_request(AdminGetTablesRequest {}))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_tables should succeed: {error}"),
    };
    assert_eq!(tables_response.tables.len(), 1);
    assert_eq!(tables_response.tables[0].name, "users");
    assert_eq!(tables_response.tables[0].row_count, 9);
    assert_eq!(lock_or_recover(&postgres_calls).list_tables_calls, 1);

    let rows_response = match handler
        .get_rows(admin_request(AdminGetRowsRequest {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 10,
            offset: 20,
            sort_column: Some(String::from("id")),
            sort_direction: Some(String::from("desc")),
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_rows should succeed: {error}"),
    };
    assert_eq!(rows_response.rows.len(), 1);
    assert!(rows_response.rows[0].fields.contains_key("id"));
    assert_eq!(
        lock_or_recover(&postgres_calls).list_rows_calls,
        vec![PostgresRowsQuery {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 10,
            offset: 20,
            sort_column: Some(String::from("id")),
            sort_direction: Some(String::from("desc")),
        }]
    );
}

#[tokio::test]
async fn columns_flow_normalizes_schema_and_table_before_gateway_calls() {
    let postgres_gateway = FakePostgresGateway {
        columns: vec![PostgresColumnRecord {
            name: String::from("id"),
            data_type: String::from("uuid"),
            nullable: false,
            default_value: None,
            ordinal_position: 1,
        }],
        ..Default::default()
    };
    let postgres_calls = Arc::clone(&postgres_gateway.calls);
    let handler = AdminServiceHandler::new(
        PostgresAdminAdapter::new(postgres_gateway),
        RedisAdminAdapter::new(FakeRedisGateway::default()),
    );

    let response = match handler
        .get_columns(admin_request(AdminGetColumnsRequest {
            schema: String::from(" public "),
            table: String::from(" users "),
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_columns should succeed: {error}"),
    };

    assert_eq!(response.columns.len(), 1);
    assert_eq!(response.columns[0].name, "id");
    assert_eq!(
        lock_or_recover(&postgres_calls).table_exists_calls,
        vec![(String::from("public"), String::from("users"))]
    );
    assert_eq!(
        lock_or_recover(&postgres_calls).list_columns_calls,
        vec![(String::from("public"), String::from("users"))]
    );
}

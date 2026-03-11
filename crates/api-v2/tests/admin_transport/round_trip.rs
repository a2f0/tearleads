use super::*;

#[tokio::test]
async fn transport_round_trip_for_wave1a_admin_endpoints() {
    let postgres_repo = FakePostgresGateway {
        info_result: Ok(PostgresInfoSnapshot {
            connection: PostgresConnectionInfo {
                host: Some(String::from("localhost")),
                port: Some(5432),
                database: Some(String::from("tearleads")),
                user: Some(String::from("tearleads")),
            },
            server_version: Some(String::from("PostgreSQL 16.6")),
        }),
        groups_result: Ok(vec![AdminGroupSummary {
            id: String::from("group-1"),
            organization_id: String::from("org-1"),
            name: String::from("Core Admin"),
            description: Some(String::from("Admin operators")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
            member_count: 2,
        }]),
        tables_result: Ok(vec![PostgresTableInfo {
            schema: String::from("public"),
            name: String::from("users"),
            row_count: 42,
            total_bytes: 8192,
            table_bytes: 4096,
            index_bytes: 4096,
        }]),
        columns_result: Ok(vec![PostgresColumnInfo {
            name: String::from("id"),
            data_type: String::from("uuid"),
            nullable: false,
            default_value: None,
            ordinal_position: 1,
        }]),
        rows_result: Ok(PostgresRowsPage {
            rows_json: vec![String::from("{\"id\":\"user-1\"}")],
            total_count: 1,
            limit: 10,
            offset: 20,
        }),
        ..Default::default()
    };
    let redis_repo = FakeRedisRepository {
        list_keys_result: Ok(RedisKeyScanPage {
            keys: vec![RedisKeyInfo {
                key: String::from("session:1"),
                key_type: String::from("string"),
                ttl_seconds: 180,
            }],
            cursor: String::from("9"),
            has_more: true,
        }),
        get_value_result: Ok(RedisKeyValueRecord {
            key: String::from("session:1"),
            key_type: String::from("string"),
            ttl_seconds: 180,
            value: Some(RedisValue::String(String::from("hello"))),
        }),
        delete_key_result: Ok(true),
        db_size_result: Ok(7),
    };
    let mut harness = spawn_admin_transport(postgres_repo, redis_repo).await;

    let info_response = match harness
        .client
        .get_postgres_info(admin_request(AdminGetPostgresInfoRequest {}))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_postgres_info should succeed over transport: {error}"),
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
        Some("PostgreSQL 16.6")
    );

    let mut list_groups_request = admin_request(AdminListGroupsRequest {
        organization_id: None,
    });
    list_groups_request.metadata_mut().insert(
        "x-tearleads-admin-scope",
        tonic::metadata::MetadataValue::from_static("root"),
    );

    let list_groups_response = match harness.client.list_groups(list_groups_request).await {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("list_groups should succeed over transport: {error}"),
    };
    assert_eq!(list_groups_response.groups.len(), 1);
    assert_eq!(list_groups_response.groups[0].name, "Core Admin");

    let tables_response = match harness
        .client
        .get_tables(admin_request(AdminGetTablesRequest {}))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_tables should succeed over transport: {error}"),
    };
    assert_eq!(tables_response.tables.len(), 1);
    assert_eq!(tables_response.tables[0].name, "users");
    assert_eq!(tables_response.tables[0].row_count, 42);

    let columns_response = match harness
        .client
        .get_columns(admin_request(AdminGetColumnsRequest {
            schema: String::from(" public "),
            table: String::from(" users "),
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_columns should succeed over transport: {error}"),
    };
    assert_eq!(columns_response.columns.len(), 1);
    assert_eq!(columns_response.columns[0].name, "id");
    assert_eq!(columns_response.columns[0].r#type, "uuid");

    let rows_response = match harness
        .client
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
        Err(error) => panic!("get_rows should succeed over transport: {error}"),
    };
    assert_eq!(rows_response.rows.len(), 1);
    assert!(rows_response.rows[0].fields.contains_key("id"));
    assert_eq!(rows_response.total_count, 1);
    assert_eq!(rows_response.limit, 10);
    assert_eq!(rows_response.offset, 20);

    let keys_response = match harness
        .client
        .get_redis_keys(admin_request(AdminGetRedisKeysRequest {
            cursor: String::from("4"),
            limit: 10,
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_redis_keys should succeed over transport: {error}"),
    };
    assert_eq!(keys_response.keys.len(), 1);
    assert_eq!(keys_response.keys[0].key, "session:1");
    assert_eq!(keys_response.cursor, "9");
    assert!(keys_response.has_more);

    let value_response = match harness
        .client
        .get_redis_value(admin_request(AdminGetRedisValueRequest {
            key: String::from(" session:1 "),
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_redis_value should succeed over transport: {error}"),
    };
    assert_eq!(value_response.key, "session:1");
    assert_eq!(
        value_response.value.and_then(|value| value.value),
        Some(admin_redis_value::Value::StringValue(String::from("hello")))
    );

    let delete_response = match harness
        .client
        .delete_redis_key(admin_request(AdminDeleteRedisKeyRequest {
            key: String::from("session:1"),
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("delete_redis_key should succeed over transport: {error}"),
    };
    assert!(delete_response.deleted);

    let db_size_response = match harness
        .client
        .get_redis_db_size(admin_request(AdminGetRedisDbSizeRequest {}))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_redis_db_size should succeed over transport: {error}"),
    };
    assert_eq!(db_size_response.count, 7);

    shutdown_admin_transport(harness).await;
}

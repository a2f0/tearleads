use crate::{AdminRequestAuthorizer, admin_auth::map_admin_auth_error};
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminDeleteRedisKeyRequest, AdminGetRedisDbSizeRequest, AdminGetRedisKeysRequest,
    AdminGetRedisValueRequest, AdminGetRowsRequest, AdminGetTablesRequest, AdminListGroupsRequest,
    admin_service_server::AdminService,
};
use tearleads_data_access_traits::{
    PostgresAdminReadRepository, PostgresRowsQuery, RedisAdminRepository, RedisValue,
};
use tonic::{Code, Request};

use super::{
    AuthorizationHeaderAdminAuthorizer, StaticPostgresRepository, StaticRedisRepository,
    create_admin_harness_handler,
};

#[test]
fn authorizer_rejects_missing_blank_non_utf8_and_non_jwt_authorization() {
    let authorizer = AuthorizationHeaderAdminAuthorizer;

    let missing = authorizer.authorize_admin_operation(
        crate::AdminOperation::GetTables,
        &tonic::metadata::MetadataMap::new(),
    );
    let missing_error = missing.expect_err("missing auth header should fail");
    let missing_status = map_admin_auth_error(missing_error);
    assert_eq!(missing_status.code(), Code::Unauthenticated);
    assert!(missing_status.message().contains("missing authorization"));

    let blank = AuthorizationHeaderAdminAuthorizer::validate_bearer_token(
        crate::AdminOperation::GetTables,
        "Bearer ",
    )
    .expect_err("blank auth header should fail");
    let blank_status = map_admin_auth_error(blank);
    assert_eq!(blank_status.code(), Code::Unauthenticated);
    assert!(
        blank_status
            .message()
            .contains("authorization must use Bearer token")
    );

    let mut malformed_metadata = tonic::metadata::MetadataMap::new();
    malformed_metadata.insert(
        "authorization",
        tonic::metadata::MetadataValue::from_static("Bearer token"),
    );
    let malformed = authorizer
        .authorize_admin_operation(crate::AdminOperation::GetTables, &malformed_metadata)
        .expect_err("non-jwt bearer token should fail");
    let malformed_status = map_admin_auth_error(malformed);
    assert_eq!(malformed_status.code(), Code::Unauthenticated);
    assert!(malformed_status.message().contains("jwt-like"));

    let mut invalid_metadata = tonic::metadata::MetadataMap::new();
    invalid_metadata.insert("authorization", parse_opaque_ascii_value(b"token\xfa"));
    let invalid = authorizer
        .authorize_admin_operation(crate::AdminOperation::GetTables, &invalid_metadata)
        .expect_err("invalid auth header should fail");
    let invalid_status = map_admin_auth_error(invalid);
    assert_eq!(invalid_status.code(), Code::Unauthenticated);
    assert!(invalid_status.message().contains("invalid authorization"));
}

#[test]
fn authorizer_accepts_jwt_like_authorization() {
    let authorizer = AuthorizationHeaderAdminAuthorizer;
    let mut metadata = tonic::metadata::MetadataMap::new();
    metadata.insert(
        "authorization",
        tonic::metadata::MetadataValue::from_static("Bearer header.payload.signature"),
    );

    let result = authorizer.authorize_admin_operation(crate::AdminOperation::GetTables, &metadata);
    assert_eq!(result, Ok(crate::AdminAccessContext::root()));
}

#[tokio::test]
async fn static_repositories_return_expected_wave1a_shapes() {
    let postgres = StaticPostgresRepository;
    let info = postgres
        .get_postgres_info()
        .await
        .expect("postgres info should succeed");
    assert_eq!(info.connection.host.as_deref(), Some("localhost"));
    assert_eq!(info.server_version.as_deref(), Some("PostgreSQL 16.7"));
    let root_scope_orgs = postgres
        .list_scope_organizations()
        .await
        .expect("root scope org listing should succeed");
    assert_eq!(root_scope_orgs.len(), 2);
    assert_eq!(root_scope_orgs[0].id, "org-1");
    assert_eq!(root_scope_orgs[0].name, "Organization 1");
    assert_eq!(root_scope_orgs[1].id, "org-2");
    assert_eq!(root_scope_orgs[1].name, "Organization 2");
    let scoped_orgs = postgres
        .list_scope_organizations_by_ids(vec![String::from("org-7"), String::from("org-9")])
        .await
        .expect("scoped org listing should succeed");
    assert_eq!(scoped_orgs.len(), 2);
    assert_eq!(scoped_orgs[0].id, "org-7");
    assert_eq!(scoped_orgs[0].name, "Organization org-7");
    assert_eq!(scoped_orgs[1].id, "org-9");
    assert_eq!(scoped_orgs[1].name, "Organization org-9");
    let groups = postgres
        .list_groups(None)
        .await
        .expect("root group listing should succeed");
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0].id, "group-1");
    assert_eq!(groups[1].id, "group-2");
    let filtered_groups = postgres
        .list_groups(Some(vec![String::from("org-2")]))
        .await
        .expect("filtered group listing should succeed");
    assert_eq!(filtered_groups.len(), 1);
    assert_eq!(filtered_groups[0].organization_id, "org-2");

    let tables = postgres
        .list_tables()
        .await
        .expect("table listing should succeed");
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].name, "users");

    let columns = postgres
        .list_columns("public", "users")
        .await
        .expect("column listing should succeed");
    assert_eq!(columns.len(), 2);
    assert_eq!(columns[0].name, "id");
    let rows = postgres
        .list_rows(PostgresRowsQuery {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 50,
            offset: 0,
            sort_column: Some(String::from("id")),
            sort_direction: Some(String::from("asc")),
        })
        .await
        .expect("rows listing should succeed");
    assert_eq!(rows.rows_json.len(), 1);

    let redis = StaticRedisRepository;
    let first_page = redis
        .list_keys("0", 10)
        .await
        .expect("redis scan should succeed");
    assert!(first_page.has_more);
    assert_eq!(first_page.cursor, "1");

    let terminal_page = redis
        .list_keys("5", 10)
        .await
        .expect("redis scan should succeed");
    assert!(!terminal_page.has_more);
    assert_eq!(terminal_page.cursor, "0");

    let value = redis
        .get_value("  session:test  ")
        .await
        .expect("redis read should succeed");
    assert_eq!(value.key, "session:test");
    assert_eq!(
        value.value,
        Some(RedisValue::String(String::from("test-value")))
    );
    let deleted = redis
        .delete_key("session:test")
        .await
        .expect("redis delete should succeed");
    assert!(deleted);
    let db_size = redis.get_db_size().await.expect("db size should succeed");
    assert_eq!(db_size, 1);
}

#[tokio::test]
async fn harness_handler_enforces_authorization_and_serves_responses() {
    let handler = create_admin_harness_handler();

    let missing_auth = handler
        .get_tables(Request::new(AdminGetTablesRequest {}))
        .await
        .expect_err("missing authorization should fail");
    assert_eq!(missing_auth.code(), Code::Unauthenticated);

    let mut tables_request = Request::new(AdminGetTablesRequest {});
    tables_request.metadata_mut().insert(
        "authorization",
        tonic::metadata::MetadataValue::from_static("Bearer header.payload.signature"),
    );
    let tables_response = handler
        .get_tables(tables_request)
        .await
        .expect("authorized request should succeed")
        .into_inner();
    assert_eq!(tables_response.tables.len(), 1);

    let mut list_groups_request = Request::new(AdminListGroupsRequest {
        organization_id: Some(String::from("org-1")),
    });
    list_groups_request.metadata_mut().insert(
        "authorization",
        tonic::metadata::MetadataValue::from_static("Bearer header.payload.signature"),
    );
    let list_groups_response = handler
        .list_groups(list_groups_request)
        .await
        .expect("authorized list groups request should succeed")
        .into_inner();
    assert_eq!(list_groups_response.groups.len(), 1);
    assert_eq!(list_groups_response.groups[0].organization_id, "org-1");

    let mut keys_request = Request::new(AdminGetRedisKeysRequest {
        cursor: String::from("0"),
        limit: 10,
    });
    keys_request.metadata_mut().insert(
        "authorization",
        tonic::metadata::MetadataValue::from_static("Bearer header.payload.signature"),
    );
    let keys_response = handler
        .get_redis_keys(keys_request)
        .await
        .expect("authorized keys request should succeed")
        .into_inner();
    assert_eq!(keys_response.keys.len(), 1);
    assert!(keys_response.has_more);

    let mut value_request = Request::new(AdminGetRedisValueRequest {
        key: String::from(" session:test "),
    });
    value_request.metadata_mut().insert(
        "authorization",
        tonic::metadata::MetadataValue::from_static("Bearer header.payload.signature"),
    );
    let value_response = handler
        .get_redis_value(value_request)
        .await
        .expect("authorized value request should succeed")
        .into_inner();
    assert_eq!(value_response.key, "session:test");

    let mut delete_request = Request::new(AdminDeleteRedisKeyRequest {
        key: String::from("session:test"),
    });
    delete_request.metadata_mut().insert(
        "authorization",
        tonic::metadata::MetadataValue::from_static("Bearer header.payload.signature"),
    );
    let delete_response = handler
        .delete_redis_key(delete_request)
        .await
        .expect("authorized delete request should succeed")
        .into_inner();
    assert!(delete_response.deleted);

    let mut rows_request = Request::new(AdminGetRowsRequest {
        schema: String::from("public"),
        table: String::from("users"),
        limit: 50,
        offset: 0,
        sort_column: Some(String::from("id")),
        sort_direction: Some(String::from("asc")),
    });
    rows_request.metadata_mut().insert(
        "authorization",
        tonic::metadata::MetadataValue::from_static("Bearer header.payload.signature"),
    );
    let rows_response = handler
        .get_rows(rows_request)
        .await
        .expect("authorized rows request should succeed")
        .into_inner();
    assert_eq!(rows_response.rows.len(), 1);

    let mut db_size_request = Request::new(AdminGetRedisDbSizeRequest {});
    db_size_request.metadata_mut().insert(
        "authorization",
        tonic::metadata::MetadataValue::from_static("Bearer header.payload.signature"),
    );
    let db_size_response = handler
        .get_redis_db_size(db_size_request)
        .await
        .expect("authorized db size request should succeed")
        .into_inner();
    assert_eq!(db_size_response.count, 1);
}

fn parse_opaque_ascii_value(bytes: &[u8]) -> tonic::metadata::AsciiMetadataValue {
    match tonic::metadata::AsciiMetadataValue::try_from(bytes) {
        Ok(value) => value,
        Err(error) => panic!("opaque ascii metadata value should parse: {error}"),
    }
}

#[test]
#[should_panic(expected = "opaque ascii metadata value should parse")]
fn parse_opaque_ascii_value_panics_for_invalid_ascii() {
    let _ = parse_opaque_ascii_value(b"\n");
}

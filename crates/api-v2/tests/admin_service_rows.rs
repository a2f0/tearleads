//! Integration tests for v2 admin service rows and Redis db-size RPCs.

use std::sync::Arc;

mod support;

use prost_types::value::Kind as ProtobufValueKind;
use support::admin_service::{
    FakeAuthorizer, FakePostgresGateway, FakeRedisRepository, into_inner_or_panic, lock_or_recover,
};
use tearleads_api_v2::AdminServiceHandler;
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminGetRedisDbSizeRequest, AdminGetRowsRequest, admin_service_server::AdminService,
};
use tearleads_data_access_traits::PostgresRowsPage;
use tonic::{Code, Request};

#[tokio::test]
async fn get_rows_forwards_normalized_query_and_maps_response() {
    let postgres_repo = FakePostgresGateway {
        rows_result: Ok(PostgresRowsPage {
            rows_json: vec![String::from("{\"id\":\"user-1\"}")],
            total_count: 1,
            limit: 10,
            offset: 20,
        }),
        ..Default::default()
    };
    let rows_calls = Arc::clone(&postgres_repo.rows_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .get_rows(Request::new(AdminGetRowsRequest {
                schema: String::from(" public "),
                table: String::from(" users "),
                limit: 10,
                offset: 20,
                sort_column: Some(String::from(" id ")),
                sort_direction: Some(String::from("DESC")),
            }))
            .await,
    );

    assert_eq!(payload.rows.len(), 1);
    assert!(payload.rows[0].fields.contains_key("id"));
    assert_eq!(payload.total_count, 1);
    assert_eq!(payload.limit, 10);
    assert_eq!(payload.offset, 20);
    assert_eq!(
        lock_or_recover(&rows_calls).clone(),
        vec![tearleads_data_access_traits::PostgresRowsQuery {
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
async fn get_rows_maps_nested_json_values_to_struct_fields() {
    let postgres_repo = FakePostgresGateway {
        rows_result: Ok(PostgresRowsPage {
            rows_json: vec![String::from(
                "{\"stringField\":\"text\",\"boolField\":true,\"numberField\":42.5,\"nullField\":null,\"listField\":[\"alpha\",2,false,{\"nested\":\"yes\"}],\"objectField\":{\"inner\":\"value\",\"innerNumber\":7}}",
            )],
            total_count: 1,
            limit: 10,
            offset: 0,
        }),
        ..Default::default()
    };
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .get_rows(Request::new(AdminGetRowsRequest {
                schema: String::from("public"),
                table: String::from("users"),
                limit: 10,
                offset: 0,
                sort_column: None,
                sort_direction: None,
            }))
            .await,
    );

    let row = &payload.rows[0];
    assert!(matches!(
        row.fields.get("stringField").and_then(|value| value.kind.as_ref()),
        Some(ProtobufValueKind::StringValue(value)) if value == "text"
    ));
    assert!(matches!(
        row.fields
            .get("boolField")
            .and_then(|value| value.kind.as_ref()),
        Some(ProtobufValueKind::BoolValue(true))
    ));
    assert!(matches!(
        row.fields.get("numberField").and_then(|value| value.kind.as_ref()),
        Some(ProtobufValueKind::NumberValue(value)) if (*value - 42.5).abs() < f64::EPSILON
    ));
    assert!(matches!(
        row.fields
            .get("nullField")
            .and_then(|value| value.kind.as_ref()),
        Some(ProtobufValueKind::NullValue(0))
    ));

    match row
        .fields
        .get("listField")
        .and_then(|value| value.kind.as_ref())
    {
        Some(ProtobufValueKind::ListValue(list)) => {
            assert_eq!(list.values.len(), 4);
        }
        _ => panic!("listField must map to a protobuf ListValue"),
    }

    match row
        .fields
        .get("objectField")
        .and_then(|value| value.kind.as_ref())
    {
        Some(ProtobufValueKind::StructValue(struct_value)) => {
            assert!(struct_value.fields.contains_key("inner"));
            assert!(struct_value.fields.contains_key("innerNumber"));
        }
        _ => panic!("objectField must map to a protobuf StructValue"),
    }
}

#[tokio::test]
async fn get_rows_returns_internal_for_invalid_row_json() {
    let postgres_repo = FakePostgresGateway {
        rows_result: Ok(PostgresRowsPage {
            rows_json: vec![String::from("{not-json")],
            total_count: 1,
            limit: 10,
            offset: 0,
        }),
        ..Default::default()
    };
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_rows(Request::new(AdminGetRowsRequest {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 10,
            offset: 0,
            sort_column: None,
            sort_direction: None,
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("invalid row json should fail with an internal error"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::Internal);
    assert!(
        status
            .message()
            .contains("failed to encode row 0: invalid JSON payload")
    );
}

#[tokio::test]
async fn get_rows_returns_internal_for_non_object_row_json() {
    let postgres_repo = FakePostgresGateway {
        rows_result: Ok(PostgresRowsPage {
            rows_json: vec![String::from("\"not-an-object\"")],
            total_count: 1,
            limit: 10,
            offset: 0,
        }),
        ..Default::default()
    };
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_rows(Request::new(AdminGetRowsRequest {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 10,
            offset: 0,
            sort_column: None,
            sort_direction: None,
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("non-object row json should fail with an internal error"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::Internal);
    assert!(
        status
            .message()
            .contains("failed to encode row 0: row payload must decode to an object")
    );
}

#[tokio::test]
async fn get_rows_rejects_invalid_sort_direction() {
    let postgres_repo = FakePostgresGateway::default();
    let rows_calls = Arc::clone(&postgres_repo.rows_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_rows(Request::new(AdminGetRowsRequest {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 10,
            offset: 0,
            sort_column: Some(String::from("id")),
            sort_direction: Some(String::from("sideways")),
        }))
        .await;
    let status = match result {
        Ok(_) => panic!("invalid sort direction must fail validation"),
        Err(error) => error,
    };

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(
        status.message(),
        "sort_direction must be \"asc\" or \"desc\""
    );
    assert!(lock_or_recover(&rows_calls).is_empty());
}

#[tokio::test]
async fn get_rows_normalizes_asc_sort_direction() {
    let postgres_repo = FakePostgresGateway {
        rows_result: Ok(PostgresRowsPage {
            rows_json: Vec::new(),
            total_count: 0,
            limit: 5,
            offset: 0,
        }),
        ..Default::default()
    };
    let rows_calls = Arc::clone(&postgres_repo.rows_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_rows(Request::new(AdminGetRowsRequest {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 5,
            offset: 0,
            sort_column: Some(String::from("id")),
            sort_direction: Some(String::from("ASC")),
        }))
        .await;
    if let Err(error) = result {
        panic!("ASC sort direction should be accepted, got: {error}");
    }

    assert_eq!(
        lock_or_recover(&rows_calls).clone(),
        vec![tearleads_data_access_traits::PostgresRowsQuery {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 5,
            offset: 0,
            sort_column: Some(String::from("id")),
            sort_direction: Some(String::from("asc")),
        }]
    );
}

#[tokio::test]
async fn get_rows_normalizes_zero_limit_to_default() {
    let postgres_repo = FakePostgresGateway {
        rows_result: Ok(PostgresRowsPage {
            rows_json: Vec::new(),
            total_count: 0,
            limit: 50,
            offset: 0,
        }),
        ..Default::default()
    };
    let rows_calls = Arc::clone(&postgres_repo.rows_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let response = handler
        .get_rows(Request::new(AdminGetRowsRequest {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 0,
            offset: 0,
            sort_column: None,
            sort_direction: None,
        }))
        .await;
    let _ = match response {
        Ok(payload) => payload.into_inner(),
        Err(error) => panic!("row listing should succeed, got: {error}"),
    };

    assert_eq!(
        lock_or_recover(&rows_calls).clone(),
        vec![tearleads_data_access_traits::PostgresRowsQuery {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 50,
            offset: 0,
            sort_column: None,
            sort_direction: None,
        }]
    );
}

#[tokio::test]
async fn get_rows_treats_blank_sort_direction_as_none() {
    let postgres_repo = FakePostgresGateway {
        rows_result: Ok(PostgresRowsPage {
            rows_json: Vec::new(),
            total_count: 0,
            limit: 10,
            offset: 0,
        }),
        ..Default::default()
    };
    let rows_calls = Arc::clone(&postgres_repo.rows_calls);
    let handler = AdminServiceHandler::with_authorizer(
        postgres_repo,
        FakeRedisRepository::default(),
        FakeAuthorizer::allow_all(),
    );

    let result = handler
        .get_rows(Request::new(AdminGetRowsRequest {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 10,
            offset: 0,
            sort_column: Some(String::from("id")),
            sort_direction: Some(String::from("   ")),
        }))
        .await;
    if let Err(error) = result {
        panic!("blank sort direction should be accepted, got: {error}");
    }

    assert_eq!(
        lock_or_recover(&rows_calls).clone(),
        vec![tearleads_data_access_traits::PostgresRowsQuery {
            schema: String::from("public"),
            table: String::from("users"),
            limit: 10,
            offset: 0,
            sort_column: Some(String::from("id")),
            sort_direction: None,
        }]
    );
}

#[tokio::test]
async fn get_redis_db_size_reads_count_from_repository() {
    let redis_repo = FakeRedisRepository {
        db_size_result: Ok(42),
        ..Default::default()
    };
    let db_size_calls = Arc::clone(&redis_repo.db_size_calls);
    let handler = AdminServiceHandler::with_authorizer(
        FakePostgresGateway::default(),
        redis_repo,
        FakeAuthorizer::allow_all(),
    );

    let payload = into_inner_or_panic(
        handler
            .get_redis_db_size(Request::new(AdminGetRedisDbSizeRequest {}))
            .await,
    );

    assert_eq!(payload.count, 42);
    assert_eq!(*lock_or_recover(&db_size_calls), 1);
}

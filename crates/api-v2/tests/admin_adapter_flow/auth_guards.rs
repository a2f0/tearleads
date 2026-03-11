use super::*;
use tonic::Code;

#[tokio::test]
async fn missing_role_header_short_circuits_before_gateway_calls() {
    let postgres_gateway = FakePostgresGateway::default();
    let postgres_calls = Arc::clone(&postgres_gateway.calls);
    let redis_gateway = FakeRedisGateway::default();
    let redis_calls = Arc::clone(&redis_gateway.calls);

    let handler = AdminServiceHandler::new(
        PostgresAdminAdapter::new(postgres_gateway),
        RedisAdminAdapter::new(redis_gateway),
    );

    let status = match handler
        .get_tables(Request::new(AdminGetTablesRequest {}))
        .await
    {
        Ok(_) => panic!("missing role header must fail"),
        Err(error) => error,
    };
    assert_eq!(status.code(), Code::Unauthenticated);
    assert!(status.message().contains("missing x-tearleads-role"));
    assert_eq!(lock_or_recover(&postgres_calls).list_tables_calls, 0);
    assert!(lock_or_recover(&redis_calls).scan_calls.is_empty());
}

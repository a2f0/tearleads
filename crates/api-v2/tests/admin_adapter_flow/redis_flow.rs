use super::*;

#[tokio::test]
async fn redis_keys_and_value_flow_through_adapter_with_normalization() {
    let redis_gateway = FakeRedisGateway {
        scan_result: RedisScanResult {
            keys: vec![RedisKeyRecord {
                key: String::from("session:1"),
                key_type: String::from("string"),
                ttl_seconds: 120,
                value: None,
            }],
            next_cursor: String::from("8"),
        },
        read_result: RedisKeyRecord {
            key: String::from("session:1"),
            key_type: String::from("string"),
            ttl_seconds: 120,
            value: Some(RedisValue::String(String::from("payload"))),
        },
        delete_key_result: true,
        db_size: 12,
        ..Default::default()
    };
    let redis_calls = Arc::clone(&redis_gateway.calls);
    let handler = AdminServiceHandler::new(
        PostgresAdminAdapter::new(FakePostgresGateway::default()),
        RedisAdminAdapter::new(redis_gateway),
    );

    let keys_response = match handler
        .get_redis_keys(admin_request(AdminGetRedisKeysRequest {
            cursor: String::from(" "),
            limit: 0,
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_redis_keys should succeed: {error}"),
    };
    assert_eq!(
        lock_or_recover(&redis_calls).scan_calls,
        vec![(String::from("0"), 50)]
    );
    assert_eq!(keys_response.keys.len(), 1);
    assert_eq!(keys_response.cursor, "8");
    assert!(keys_response.has_more);

    let value_response = match handler
        .get_redis_value(admin_request(AdminGetRedisValueRequest {
            key: String::from(" session:1 "),
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_redis_value should succeed: {error}"),
    };
    assert_eq!(
        lock_or_recover(&redis_calls).read_key_calls,
        vec![String::from("session:1")]
    );
    assert_eq!(
        value_response.value.and_then(|value| value.value),
        Some(admin_redis_value::Value::StringValue(String::from(
            "payload"
        )))
    );

    let delete_response = match handler
        .delete_redis_key(admin_request(AdminDeleteRedisKeyRequest {
            key: String::from(" session:1 "),
        }))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("delete_redis_key should succeed: {error}"),
    };
    assert!(delete_response.deleted);
    assert_eq!(
        lock_or_recover(&redis_calls).delete_key_calls,
        vec![String::from("session:1")]
    );

    let db_size_response = match handler
        .get_redis_db_size(admin_request(AdminGetRedisDbSizeRequest {}))
        .await
    {
        Ok(value) => value.into_inner(),
        Err(error) => panic!("get_redis_db_size should succeed: {error}"),
    };
    assert_eq!(db_size_response.count, 12);
    assert_eq!(lock_or_recover(&redis_calls).db_size_calls, 1);
}

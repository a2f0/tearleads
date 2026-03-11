use tearleads_data_access_traits::{
    BoxFuture, RedisAdminRepository, RedisKeyInfo, RedisKeyScanPage, RedisKeyValueRecord,
    RedisValue,
};

#[derive(Debug, Clone, Copy)]
pub struct StaticRedisRepository;

impl RedisAdminRepository for StaticRedisRepository {
    fn list_keys(
        &self,
        cursor: &str,
        _limit: u32,
    ) -> BoxFuture<'_, Result<RedisKeyScanPage, tearleads_data_access_traits::DataAccessError>>
    {
        let next_cursor = if cursor.trim() == "0" {
            String::from("1")
        } else {
            String::from("0")
        };

        Box::pin(async move {
            Ok(RedisKeyScanPage {
                keys: vec![RedisKeyInfo {
                    key: String::from("session:test"),
                    key_type: String::from("string"),
                    ttl_seconds: 120,
                }],
                cursor: next_cursor.clone(),
                has_more: next_cursor != "0",
            })
        })
    }

    fn get_value(
        &self,
        key: &str,
    ) -> BoxFuture<'_, Result<RedisKeyValueRecord, tearleads_data_access_traits::DataAccessError>>
    {
        let normalized_key = key.trim().to_string();

        Box::pin(async move {
            Ok(RedisKeyValueRecord {
                key: normalized_key,
                key_type: String::from("string"),
                ttl_seconds: 120,
                value: Some(RedisValue::String(String::from("test-value"))),
            })
        })
    }

    fn delete_key(
        &self,
        _key: &str,
    ) -> BoxFuture<'_, Result<bool, tearleads_data_access_traits::DataAccessError>> {
        Box::pin(async move { Ok(true) })
    }

    fn get_db_size(
        &self,
    ) -> BoxFuture<'_, Result<u64, tearleads_data_access_traits::DataAccessError>> {
        Box::pin(async move { Ok(1) })
    }
}

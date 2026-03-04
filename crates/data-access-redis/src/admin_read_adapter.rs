//! Adapter that maps Redis gateway records to shared admin read/write models.

use tearleads_api_domain_core::{normalize_redis_scan_cursor, normalize_redis_scan_limit};
use tearleads_data_access_traits::{
    BoxFuture, DataAccessError, DataAccessErrorKind, RedisAdminReadRepository, RedisKeyInfo,
    RedisKeyScanPage, RedisKeyValueRecord,
};

use crate::RedisAdminGateway;

/// Redis repository implementation over a driver-specific gateway.
pub struct RedisAdminReadAdapter<G> {
    gateway: G,
}

impl<G> RedisAdminReadAdapter<G> {
    /// Builds an adapter around a gateway implementation.
    pub fn new(gateway: G) -> Self {
        Self { gateway }
    }
}

impl<G> RedisAdminReadRepository for RedisAdminReadAdapter<G>
where
    G: RedisAdminGateway + Send + Sync,
{
    fn list_keys(
        &self,
        cursor: &str,
        limit: u32,
    ) -> BoxFuture<'_, Result<RedisKeyScanPage, DataAccessError>> {
        let normalized_cursor = normalize_redis_scan_cursor(cursor);
        let normalized_limit = normalize_scan_limit(limit);

        Box::pin(async move {
            let scan_result = self
                .gateway
                .scan_keys(&normalized_cursor, normalized_limit)
                .await?;
            let keys = scan_result
                .keys
                .into_iter()
                .map(|record| RedisKeyInfo {
                    key: record.key,
                    key_type: record.key_type,
                    ttl_seconds: record.ttl_seconds,
                })
                .collect();

            Ok(RedisKeyScanPage {
                keys,
                has_more: scan_result.next_cursor != "0",
                cursor: scan_result.next_cursor,
            })
        })
    }

    fn get_value(&self, key: &str) -> BoxFuture<'_, Result<RedisKeyValueRecord, DataAccessError>> {
        let normalized_key = match normalize_key(key) {
            Ok(value) => value,
            Err(error) => return Box::pin(async move { Err(error) }),
        };

        Box::pin(async move {
            let record = self.gateway.read_key(&normalized_key).await?;
            Ok(RedisKeyValueRecord {
                key: record.key,
                key_type: record.key_type,
                ttl_seconds: record.ttl_seconds,
                value: record.value,
            })
        })
    }

    fn delete_key(&self, key: &str) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let normalized_key = match normalize_key(key) {
            Ok(value) => value,
            Err(error) => return Box::pin(async move { Err(error) }),
        };

        Box::pin(async move { self.gateway.delete_key(&normalized_key).await })
    }

    fn get_db_size(&self) -> BoxFuture<'_, Result<u64, DataAccessError>> {
        Box::pin(async move { self.gateway.read_db_size().await })
    }
}

fn normalize_scan_limit(limit: u32) -> u32 {
    let limit_as_i32 = i32::try_from(limit).unwrap_or(i32::MAX);
    normalize_redis_scan_limit(limit_as_i32)
}

fn normalize_key(key: &str) -> Result<String, DataAccessError> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err(DataAccessError::new(
            DataAccessErrorKind::InvalidInput,
            "key must not be empty",
        ));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use std::sync::{Mutex, MutexGuard};

    use futures::executor::block_on;
    use tearleads_data_access_traits::{
        BoxFuture, DataAccessError, DataAccessErrorKind, RedisAdminReadRepository, RedisValue,
    };

    use super::RedisAdminReadAdapter;
    use crate::{RedisAdminGateway, RedisKeyRecord, RedisScanResult};

    #[derive(Debug)]
    struct FakeGateway {
        scan_result: Result<RedisScanResult, DataAccessError>,
        read_result: Result<RedisKeyRecord, DataAccessError>,
        delete_result: Result<bool, DataAccessError>,
        db_size_result: Result<u64, DataAccessError>,
        scan_calls: Mutex<Vec<(String, u32)>>,
        read_calls: Mutex<Vec<String>>,
        delete_calls: Mutex<Vec<String>>,
        db_size_calls: Mutex<usize>,
    }

    impl Default for FakeGateway {
        fn default() -> Self {
            Self {
                scan_result: Ok(RedisScanResult {
                    keys: Vec::new(),
                    next_cursor: String::from("0"),
                }),
                read_result: Ok(RedisKeyRecord {
                    key: String::from("sample"),
                    key_type: String::from("string"),
                    ttl_seconds: -1,
                    value: Some(RedisValue::String(String::from("value"))),
                }),
                delete_result: Ok(false),
                db_size_result: Ok(0),
                scan_calls: Mutex::new(Vec::new()),
                read_calls: Mutex::new(Vec::new()),
                delete_calls: Mutex::new(Vec::new()),
                db_size_calls: Mutex::new(0),
            }
        }
    }

    impl FakeGateway {
        fn scan_calls(&self) -> Vec<(String, u32)> {
            lock_or_recover(&self.scan_calls).clone()
        }

        fn read_calls(&self) -> Vec<String> {
            lock_or_recover(&self.read_calls).clone()
        }

        fn delete_calls(&self) -> Vec<String> {
            lock_or_recover(&self.delete_calls).clone()
        }

        fn db_size_calls(&self) -> usize {
            *lock_or_recover(&self.db_size_calls)
        }
    }

    impl RedisAdminGateway for FakeGateway {
        fn scan_keys(
            &self,
            cursor: &str,
            limit: u32,
        ) -> BoxFuture<'_, Result<RedisScanResult, DataAccessError>> {
            lock_or_recover(&self.scan_calls).push((cursor.to_string(), limit));
            let result = self.scan_result.clone();
            Box::pin(async move { result })
        }

        fn read_key(&self, key: &str) -> BoxFuture<'_, Result<RedisKeyRecord, DataAccessError>> {
            lock_or_recover(&self.read_calls).push(key.to_string());
            let result = self.read_result.clone();
            Box::pin(async move { result })
        }

        fn delete_key(&self, key: &str) -> BoxFuture<'_, Result<bool, DataAccessError>> {
            lock_or_recover(&self.delete_calls).push(key.to_string());
            let result = self.delete_result.clone();
            Box::pin(async move { result })
        }

        fn read_db_size(&self) -> BoxFuture<'_, Result<u64, DataAccessError>> {
            *lock_or_recover(&self.db_size_calls) += 1;
            let result = self.db_size_result.clone();
            Box::pin(async move { result })
        }
    }

    #[test]
    fn list_keys_normalizes_cursor_and_default_limit() {
        let gateway = FakeGateway {
            scan_result: Ok(RedisScanResult {
                keys: vec![RedisKeyRecord {
                    key: String::from("session:abc"),
                    key_type: String::from("string"),
                    ttl_seconds: 120,
                    value: None,
                }],
                next_cursor: String::from("5"),
            }),
            ..Default::default()
        };
        let adapter = RedisAdminReadAdapter::new(gateway);

        let result = block_on(adapter.list_keys("  ", 0));
        let page = match result {
            Ok(value) => value,
            Err(error) => panic!("scan should succeed, got: {error}"),
        };

        assert_eq!(adapter.gateway.scan_calls(), vec![(String::from("0"), 50)]);
        assert_eq!(page.cursor, "5");
        assert!(page.has_more);
        assert_eq!(page.keys.len(), 1);
        assert_eq!(page.keys[0].key, "session:abc");
        assert_eq!(page.keys[0].key_type, "string");
        assert_eq!(page.keys[0].ttl_seconds, 120);
    }

    #[test]
    fn list_keys_caps_limit_and_marks_terminal_cursor() {
        let gateway = FakeGateway::default();
        let adapter = RedisAdminReadAdapter::new(gateway);

        let result = block_on(adapter.list_keys("9", u32::MAX));
        let page = match result {
            Ok(value) => value,
            Err(error) => panic!("scan should succeed, got: {error}"),
        };

        assert_eq!(adapter.gateway.scan_calls(), vec![(String::from("9"), 100)]);
        assert_eq!(page.cursor, "0");
        assert!(!page.has_more);
    }

    #[test]
    fn get_value_trims_keys_before_gateway_lookup() {
        let gateway = FakeGateway {
            read_result: Ok(RedisKeyRecord {
                key: String::from("session:abc"),
                key_type: String::from("string"),
                ttl_seconds: 42,
                value: Some(RedisValue::String(String::from("payload"))),
            }),
            ..Default::default()
        };
        let adapter = RedisAdminReadAdapter::new(gateway);

        let result = block_on(adapter.get_value("  session:abc  "));
        let record = match result {
            Ok(value) => value,
            Err(error) => panic!("value lookup should succeed, got: {error}"),
        };

        assert_eq!(
            adapter.gateway.read_calls(),
            vec![String::from("session:abc")]
        );
        assert_eq!(record.key, "session:abc");
        assert_eq!(record.key_type, "string");
        assert_eq!(record.ttl_seconds, 42);
        assert_eq!(
            record.value,
            Some(RedisValue::String(String::from("payload")))
        );
    }

    #[test]
    fn get_value_rejects_blank_keys_before_gateway_io() {
        let gateway = FakeGateway::default();
        let adapter = RedisAdminReadAdapter::new(gateway);

        let result = block_on(adapter.get_value("   "));
        let error = match result {
            Ok(_) => panic!("blank keys must fail validation"),
            Err(error) => error,
        };

        assert_eq!(error.kind(), DataAccessErrorKind::InvalidInput);
        assert_eq!(error.message(), "key must not be empty");
        assert!(adapter.gateway.read_calls().is_empty());
    }

    #[test]
    fn delete_key_trims_keys_before_gateway_delete() {
        let gateway = FakeGateway {
            delete_result: Ok(true),
            ..Default::default()
        };
        let adapter = RedisAdminReadAdapter::new(gateway);

        let result = block_on(adapter.delete_key("  session:abc  "));
        let deleted = match result {
            Ok(value) => value,
            Err(error) => panic!("delete should succeed, got: {error}"),
        };

        assert!(deleted);
        assert_eq!(
            adapter.gateway.delete_calls(),
            vec![String::from("session:abc")]
        );
    }

    #[test]
    fn delete_key_rejects_blank_keys_before_gateway_io() {
        let gateway = FakeGateway::default();
        let adapter = RedisAdminReadAdapter::new(gateway);

        let result = block_on(adapter.delete_key("  "));
        let error = match result {
            Ok(_) => panic!("blank keys must fail validation"),
            Err(error) => error,
        };

        assert_eq!(error.kind(), DataAccessErrorKind::InvalidInput);
        assert_eq!(error.message(), "key must not be empty");
        assert!(adapter.gateway.delete_calls().is_empty());
    }

    #[test]
    fn list_keys_propagates_gateway_error() {
        let unavailable = DataAccessError::new(DataAccessErrorKind::Unavailable, "redis timeout");
        let gateway = FakeGateway {
            scan_result: Err(unavailable.clone()),
            ..Default::default()
        };
        let adapter = RedisAdminReadAdapter::new(gateway);

        let result = block_on(adapter.list_keys("0", 10));
        let error = match result {
            Ok(_) => panic!("gateway errors must bubble up"),
            Err(error) => error,
        };

        assert_eq!(error, unavailable);
    }

    #[test]
    fn get_db_size_reads_count_via_gateway() {
        let gateway = FakeGateway {
            db_size_result: Ok(42),
            ..Default::default()
        };
        let adapter = RedisAdminReadAdapter::new(gateway);

        let result = block_on(adapter.get_db_size());
        let count = match result {
            Ok(value) => value,
            Err(error) => panic!("db size lookup should succeed, got: {error}"),
        };

        assert_eq!(count, 42);
        assert_eq!(adapter.gateway.db_size_calls(), 1);
    }

    fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        match mutex.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

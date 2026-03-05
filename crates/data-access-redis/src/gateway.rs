//! Driver-facing gateway abstraction for Redis admin read/write operations.

use tearleads_data_access_traits::{BoxFuture, DataAccessError, RedisValue};

/// Raw key metadata and payload returned by the backing Redis driver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedisKeyRecord {
    /// Redis key name.
    pub key: String,
    /// Redis data type (`string`, `set`, `hash`, etc).
    pub key_type: String,
    /// TTL in seconds. `-1` means no expiry.
    pub ttl_seconds: i64,
    /// Optional value payload for key value lookups.
    pub value: Option<RedisValue>,
}

/// Cursor page returned by Redis key scans.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedisScanResult {
    /// Keys in this scan page.
    pub keys: Vec<RedisKeyRecord>,
    /// Cursor to request the next page.
    pub next_cursor: String,
}

/// Driver gateway used by [`crate::RedisAdminAdapter`].
pub trait RedisAdminGateway: Send + Sync {
    /// Performs one cursor-based key scan.
    fn scan_keys(
        &self,
        cursor: &str,
        limit: u32,
    ) -> BoxFuture<'_, Result<RedisScanResult, DataAccessError>>;

    /// Reads one key value payload.
    fn read_key(&self, key: &str) -> BoxFuture<'_, Result<RedisKeyRecord, DataAccessError>>;

    /// Deletes one key by name and returns whether it existed.
    fn delete_key(&self, key: &str) -> BoxFuture<'_, Result<bool, DataAccessError>>;

    /// Reads the total key count for the selected database.
    fn read_db_size(&self) -> BoxFuture<'_, Result<u64, DataAccessError>>;
}

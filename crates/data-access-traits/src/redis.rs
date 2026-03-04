//! Redis read models and repository boundary traits.

use std::collections::BTreeMap;

use crate::{BoxFuture, DataAccessError};

/// Metadata for a single Redis key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedisKeyInfo {
    /// Key name.
    pub key: String,
    /// Redis data type (`string`, `set`, `hash`, etc).
    pub key_type: String,
    /// TTL in seconds. `-1` means no expiry.
    pub ttl_seconds: i64,
}

/// Cursor-based key listing page from Redis SCAN.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedisKeyScanPage {
    /// Keys discovered in this page.
    pub keys: Vec<RedisKeyInfo>,
    /// Cursor value to continue scanning.
    pub cursor: String,
    /// Whether additional pages remain.
    pub has_more: bool,
}

/// Strongly typed Redis value variants returned by admin reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RedisValue {
    /// String scalar value.
    String(String),
    /// String list/set-like payload.
    List(Vec<String>),
    /// Hash/object payload.
    Map(BTreeMap<String, String>),
}

/// Full value payload for one Redis key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedisKeyValueRecord {
    /// Key name.
    pub key: String,
    /// Redis data type.
    pub key_type: String,
    /// TTL in seconds. `-1` means no expiry.
    pub ttl_seconds: i64,
    /// Value payload when the key maps to a supported type.
    pub value: Option<RedisValue>,
}

/// Repository boundary for Wave 1A Redis admin reads.
pub trait RedisAdminReadRepository: Send + Sync {
    /// Lists keys using cursor pagination.
    fn list_keys(
        &self,
        cursor: &str,
        limit: u32,
    ) -> BoxFuture<'_, Result<RedisKeyScanPage, DataAccessError>>;

    /// Returns one key payload by key name.
    fn get_value(&self, key: &str) -> BoxFuture<'_, Result<RedisKeyValueRecord, DataAccessError>>;
}

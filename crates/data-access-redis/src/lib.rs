//! Native Redis adapter implementations for API v2 data-access traits.

mod admin_adapter;
mod gateway;

pub use admin_adapter::RedisAdminAdapter;
pub use gateway::{RedisAdminGateway, RedisKeyRecord, RedisScanResult};

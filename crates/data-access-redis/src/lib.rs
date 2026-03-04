//! Native Redis adapter implementations for API v2 data-access traits.

mod admin_read_adapter;
mod gateway;

pub use admin_read_adapter::RedisAdminReadAdapter;
pub use gateway::{RedisAdminGateway, RedisKeyRecord, RedisScanResult};

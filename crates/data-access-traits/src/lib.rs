//! Shared data-access traits for API v2 services.

mod error;
mod postgres;
mod redis;

use std::{future::Future, pin::Pin};

pub use error::{DataAccessError, DataAccessErrorKind};
pub use postgres::{
    AdminGroupDetail, AdminGroupMember, AdminGroupSummary, AdminOrganizationSummary,
    AdminScopeOrganization, AdminUserAccountingSummary, AdminUserSummary,
    PostgresAdminReadRepository, PostgresColumnInfo, PostgresConnectionInfo, PostgresInfoSnapshot,
    PostgresRowsPage, PostgresRowsQuery, PostgresTableInfo,
};
pub use redis::{
    RedisAdminRepository, RedisKeyInfo, RedisKeyScanPage, RedisKeyValueRecord, RedisValue,
};

/// Convenience alias for a boxed async return used by repository traits.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

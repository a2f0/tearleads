//! Shared data-access traits for API v2 services.

mod ai_usage;
mod auth;
mod billing;
mod error;
mod postgres;
mod redis;

use std::{future::Future, pin::Pin};

pub use ai_usage::{
    AiRecordUsageInput, AiUsagePage, AiUsageQuery, AiUsageRecord, AiUsageSummary,
    AiUsageSummaryByModel, PostgresAiUsageRepository,
};
pub use auth::{
    AuthCreateSessionInput, AuthLoginUser, AuthOrganization, AuthRefreshToken, AuthRegisterInput,
    AuthRegisteredUser, AuthSession, AuthVfsKeySetupInput, PostgresAuthRepository,
    RedisAuthSessionRepository,
};
pub use billing::{OrganizationBillingAccount, PostgresBillingRepository};
pub use error::{DataAccessError, DataAccessErrorKind};
pub use postgres::{
    AdminCreateGroupInput, AdminCreateOrganizationInput, AdminGroupDetail, AdminGroupMember,
    AdminGroupSummary, AdminOrganizationSummary, AdminOrganizationUserSummary,
    AdminScopeOrganization, AdminUpdateGroupInput, AdminUpdateOrganizationInput,
    AdminUpdateUserInput, AdminUserAccountingSummary, AdminUserSummary, PostgresAdminRepository,
    PostgresColumnInfo, PostgresConnectionInfo, PostgresInfoSnapshot, PostgresRowsPage,
    PostgresRowsQuery, PostgresTableInfo,
};
pub use redis::{
    RedisAdminRepository, RedisKeyInfo, RedisKeyScanPage, RedisKeyValueRecord, RedisValue,
};

/// Convenience alias for a boxed async return used by repository traits.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

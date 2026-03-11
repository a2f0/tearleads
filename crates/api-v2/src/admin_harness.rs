//! Test harness admin repositories and auth policy for browser-facing v2 routes.

mod authorizer;
mod postgres_repository;
mod redis_repository;

use authorizer::AuthorizationHeaderAdminAuthorizer;
pub(crate) use postgres_repository::StaticPostgresRepository;
pub(crate) use redis_repository::StaticRedisRepository;

use crate::AdminServiceHandler;

pub(crate) fn create_admin_handler() -> AdminServiceHandler<
    StaticPostgresRepository,
    StaticRedisRepository,
    AuthorizationHeaderAdminAuthorizer,
> {
    AdminServiceHandler::with_authorizer(
        StaticPostgresRepository,
        StaticRedisRepository,
        AuthorizationHeaderAdminAuthorizer,
    )
}


#[cfg(test)]
#[allow(clippy::expect_used)]
mod postgres_repository_tests;

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests;

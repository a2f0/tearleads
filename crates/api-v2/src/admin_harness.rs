//! Test harness admin repositories and auth policy for browser-facing v2 routes.

use tearleads_data_access_traits::{
    BoxFuture, PostgresAdminReadRepository, PostgresConnectionInfo, PostgresInfoSnapshot,
    PostgresTableInfo, RedisAdminReadRepository, RedisKeyInfo, RedisKeyScanPage,
    RedisKeyValueRecord, RedisValue,
};

use crate::{
    AdminAuthError, AdminAuthErrorKind, AdminOperation, AdminRequestAuthorizer, AdminServiceHandler,
};

#[derive(Debug, Clone, Copy)]
pub(crate) struct AuthorizationHeaderAdminAuthorizer;

impl AuthorizationHeaderAdminAuthorizer {
    const AUTHORIZATION_HEADER: &'static str = "authorization";
}

impl AdminRequestAuthorizer for AuthorizationHeaderAdminAuthorizer {
    fn authorize_admin_operation(
        &self,
        operation: AdminOperation,
        metadata: &tonic::metadata::MetadataMap,
    ) -> Result<(), AdminAuthError> {
        let authorization = metadata
            .get(Self::AUTHORIZATION_HEADER)
            .ok_or_else(|| {
                AdminAuthError::new(
                    AdminAuthErrorKind::Unauthenticated,
                    format!("missing {} for {:?}", Self::AUTHORIZATION_HEADER, operation),
                )
            })?
            .to_str()
            .map_err(|_| {
                AdminAuthError::new(
                    AdminAuthErrorKind::Unauthenticated,
                    format!("invalid {} for {:?}", Self::AUTHORIZATION_HEADER, operation),
                )
            })?;

        if authorization.trim().is_empty() {
            return Err(AdminAuthError::new(
                AdminAuthErrorKind::Unauthenticated,
                format!(
                    "{} must not be blank for {:?}",
                    Self::AUTHORIZATION_HEADER,
                    operation
                ),
            ));
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct StaticPostgresRepository;

impl PostgresAdminReadRepository for StaticPostgresRepository {
    fn get_postgres_info(
        &self,
    ) -> BoxFuture<'_, Result<PostgresInfoSnapshot, tearleads_data_access_traits::DataAccessError>>
    {
        Box::pin(async move {
            Ok(PostgresInfoSnapshot {
                connection: PostgresConnectionInfo {
                    host: Some(String::from("localhost")),
                    port: Some(5432),
                    database: Some(String::from("tearleads")),
                    user: Some(String::from("tearleads")),
                },
                server_version: Some(String::from("PostgreSQL 16.7")),
            })
        })
    }

    fn list_tables(
        &self,
    ) -> BoxFuture<'_, Result<Vec<PostgresTableInfo>, tearleads_data_access_traits::DataAccessError>>
    {
        Box::pin(async move {
            Ok(vec![PostgresTableInfo {
                schema: String::from("public"),
                name: String::from("users"),
                row_count: 1,
                total_bytes: 8192,
                table_bytes: 4096,
                index_bytes: 4096,
            }])
        })
    }

    fn list_columns(
        &self,
        _schema: &str,
        _table: &str,
    ) -> BoxFuture<
        '_,
        Result<
            Vec<tearleads_data_access_traits::PostgresColumnInfo>,
            tearleads_data_access_traits::DataAccessError,
        >,
    > {
        Box::pin(async move {
            Ok(vec![
                tearleads_data_access_traits::PostgresColumnInfo {
                    name: String::from("id"),
                    data_type: String::from("uuid"),
                    nullable: false,
                    default_value: None,
                    ordinal_position: 1,
                },
                tearleads_data_access_traits::PostgresColumnInfo {
                    name: String::from("email"),
                    data_type: String::from("text"),
                    nullable: false,
                    default_value: None,
                    ordinal_position: 2,
                },
            ])
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct StaticRedisRepository;

impl RedisAdminReadRepository for StaticRedisRepository {
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
}

pub(crate) fn create_admin_harness_handler() -> AdminServiceHandler<
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

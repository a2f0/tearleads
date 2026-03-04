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

#[cfg(test)]
mod tests {
    use crate::{AdminRequestAuthorizer, admin_auth::map_admin_auth_error};
    use tearleads_api_v2_contracts::tearleads::v2::{
        AdminGetRedisKeysRequest, AdminGetRedisValueRequest, AdminGetTablesRequest,
        admin_service_server::AdminService,
    };
    use tearleads_data_access_traits::{
        PostgresAdminReadRepository, RedisAdminReadRepository, RedisValue,
    };
    use tonic::{Code, Request};

    use super::{
        AuthorizationHeaderAdminAuthorizer, StaticPostgresRepository, StaticRedisRepository,
        create_admin_harness_handler,
    };

    #[test]
    fn authorizer_rejects_missing_blank_and_non_utf8_authorization() {
        let authorizer = AuthorizationHeaderAdminAuthorizer;

        let missing = authorizer.authorize_admin_operation(
            crate::AdminOperation::GetTables,
            &tonic::metadata::MetadataMap::new(),
        );
        let missing_error = missing.expect_err("missing auth header should fail");
        let missing_status = map_admin_auth_error(missing_error);
        assert_eq!(missing_status.code(), Code::Unauthenticated);
        assert!(missing_status.message().contains("missing authorization"));

        let mut blank_metadata = tonic::metadata::MetadataMap::new();
        blank_metadata.insert(
            "authorization",
            tonic::metadata::MetadataValue::from_static("   "),
        );
        let blank = authorizer
            .authorize_admin_operation(crate::AdminOperation::GetTables, &blank_metadata)
            .expect_err("blank auth header should fail");
        let blank_status = map_admin_auth_error(blank);
        assert_eq!(blank_status.code(), Code::Unauthenticated);
        assert!(blank_status.message().contains("must not be blank"));

        let mut invalid_metadata = tonic::metadata::MetadataMap::new();
        invalid_metadata.insert("authorization", parse_opaque_ascii_value(b"token\xfa"));
        let invalid = authorizer
            .authorize_admin_operation(crate::AdminOperation::GetTables, &invalid_metadata)
            .expect_err("invalid auth header should fail");
        let invalid_status = map_admin_auth_error(invalid);
        assert_eq!(invalid_status.code(), Code::Unauthenticated);
        assert!(invalid_status.message().contains("invalid authorization"));
    }

    #[test]
    fn authorizer_accepts_non_empty_authorization() {
        let authorizer = AuthorizationHeaderAdminAuthorizer;
        let mut metadata = tonic::metadata::MetadataMap::new();
        metadata.insert(
            "authorization",
            tonic::metadata::MetadataValue::from_static("Bearer token"),
        );

        let result =
            authorizer.authorize_admin_operation(crate::AdminOperation::GetTables, &metadata);
        assert_eq!(result, Ok(()));
    }

    #[tokio::test]
    async fn static_repositories_return_expected_wave1a_shapes() {
        let postgres = StaticPostgresRepository;
        let info = postgres
            .get_postgres_info()
            .await
            .expect("postgres info should succeed");
        assert_eq!(info.connection.host.as_deref(), Some("localhost"));
        assert_eq!(info.server_version.as_deref(), Some("PostgreSQL 16.7"));

        let tables = postgres
            .list_tables()
            .await
            .expect("table listing should succeed");
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].name, "users");

        let columns = postgres
            .list_columns("public", "users")
            .await
            .expect("column listing should succeed");
        assert_eq!(columns.len(), 2);
        assert_eq!(columns[0].name, "id");

        let redis = StaticRedisRepository;
        let first_page = redis
            .list_keys("0", 10)
            .await
            .expect("redis scan should succeed");
        assert!(first_page.has_more);
        assert_eq!(first_page.cursor, "1");

        let terminal_page = redis
            .list_keys("5", 10)
            .await
            .expect("redis scan should succeed");
        assert!(!terminal_page.has_more);
        assert_eq!(terminal_page.cursor, "0");

        let value = redis
            .get_value("  session:test  ")
            .await
            .expect("redis read should succeed");
        assert_eq!(value.key, "session:test");
        assert_eq!(
            value.value,
            Some(RedisValue::String(String::from("test-value")))
        );
    }

    #[tokio::test]
    async fn harness_handler_enforces_authorization_and_serves_responses() {
        let handler = create_admin_harness_handler();

        let missing_auth = handler
            .get_tables(Request::new(AdminGetTablesRequest {}))
            .await
            .expect_err("missing authorization should fail");
        assert_eq!(missing_auth.code(), Code::Unauthenticated);

        let mut tables_request = Request::new(AdminGetTablesRequest {});
        tables_request.metadata_mut().insert(
            "authorization",
            tonic::metadata::MetadataValue::from_static("Bearer token"),
        );
        let tables_response = handler
            .get_tables(tables_request)
            .await
            .expect("authorized request should succeed")
            .into_inner();
        assert_eq!(tables_response.tables.len(), 1);

        let mut keys_request = Request::new(AdminGetRedisKeysRequest {
            cursor: String::from("0"),
            limit: 10,
        });
        keys_request.metadata_mut().insert(
            "authorization",
            tonic::metadata::MetadataValue::from_static("Bearer token"),
        );
        let keys_response = handler
            .get_redis_keys(keys_request)
            .await
            .expect("authorized keys request should succeed")
            .into_inner();
        assert_eq!(keys_response.keys.len(), 1);
        assert!(keys_response.has_more);

        let mut value_request = Request::new(AdminGetRedisValueRequest {
            key: String::from(" session:test "),
        });
        value_request.metadata_mut().insert(
            "authorization",
            tonic::metadata::MetadataValue::from_static("Bearer token"),
        );
        let value_response = handler
            .get_redis_value(value_request)
            .await
            .expect("authorized value request should succeed")
            .into_inner();
        assert_eq!(value_response.key, "session:test");
    }

    fn parse_opaque_ascii_value(bytes: &[u8]) -> tonic::metadata::AsciiMetadataValue {
        match tonic::metadata::AsciiMetadataValue::try_from(bytes) {
            Ok(value) => value,
            Err(error) => panic!("opaque ascii metadata value should parse: {error}"),
        }
    }

    #[test]
    #[should_panic(expected = "opaque ascii metadata value should parse")]
    fn parse_opaque_ascii_value_panics_for_invalid_ascii() {
        let _ = parse_opaque_ascii_value(b"\n");
    }
}

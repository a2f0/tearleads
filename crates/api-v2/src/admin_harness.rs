//! Test harness admin repositories and auth policy for browser-facing v2 routes.

use tearleads_data_access_traits::{
    AdminGroupDetail, AdminGroupMember, AdminGroupSummary, AdminOrganizationSummary,
    AdminScopeOrganization, AdminUserAccountingSummary, AdminUserSummary, BoxFuture,
    DataAccessError, DataAccessErrorKind, PostgresAdminReadRepository, PostgresConnectionInfo,
    PostgresInfoSnapshot, PostgresRowsPage, PostgresRowsQuery, PostgresTableInfo,
    RedisAdminRepository, RedisKeyInfo, RedisKeyScanPage, RedisKeyValueRecord, RedisValue,
};

use crate::{
    AdminAccessContext, AdminAuthError, AdminAuthErrorKind, AdminOperation, AdminRequestAuthorizer,
    AdminServiceHandler,
};

#[derive(Debug, Clone, Copy)]
pub(crate) struct AuthorizationHeaderAdminAuthorizer;

impl AuthorizationHeaderAdminAuthorizer {
    const AUTHORIZATION_HEADER: &'static str = "authorization";

    fn unauthenticated_error(operation: AdminOperation, message: &str) -> AdminAuthError {
        AdminAuthError::new(AdminAuthErrorKind::Unauthenticated, {
            format!("{message} for {:?}", operation)
        })
    }

    fn validate_bearer_token(
        operation: AdminOperation,
        authorization: &str,
    ) -> Result<(), AdminAuthError> {
        let bearer_token = authorization
            .trim()
            .strip_prefix("Bearer ")
            .ok_or_else(|| {
                Self::unauthenticated_error(operation, "authorization must use Bearer token")
            })?;

        let segments: Vec<&str> = bearer_token.split('.').collect();
        if segments.len() != 3 || segments.iter().any(|segment| segment.is_empty()) {
            return Err(Self::unauthenticated_error(
                operation,
                "bearer token must be jwt-like",
            ));
        }

        Ok(())
    }
}

impl AdminRequestAuthorizer for AuthorizationHeaderAdminAuthorizer {
    fn authorize_admin_operation(
        &self,
        operation: AdminOperation,
        metadata: &tonic::metadata::MetadataMap,
    ) -> Result<AdminAccessContext, AdminAuthError> {
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

        Self::validate_bearer_token(operation, authorization)?;
        Ok(AdminAccessContext::root())
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

    fn list_scope_organizations(
        &self,
    ) -> BoxFuture<
        '_,
        Result<Vec<AdminScopeOrganization>, tearleads_data_access_traits::DataAccessError>,
    > {
        Box::pin(async move {
            Ok(vec![
                AdminScopeOrganization {
                    id: String::from("org-1"),
                    name: String::from("Organization 1"),
                },
                AdminScopeOrganization {
                    id: String::from("org-2"),
                    name: String::from("Organization 2"),
                },
            ])
        })
    }

    fn list_scope_organizations_by_ids(
        &self,
        organization_ids: Vec<String>,
    ) -> BoxFuture<
        '_,
        Result<Vec<AdminScopeOrganization>, tearleads_data_access_traits::DataAccessError>,
    > {
        Box::pin(async move {
            Ok(organization_ids
                .into_iter()
                .map(|id| AdminScopeOrganization {
                    name: format!("Organization {id}"),
                    id,
                })
                .collect())
        })
    }

    fn list_groups(
        &self,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminGroupSummary>, tearleads_data_access_traits::DataAccessError>>
    {
        Box::pin(async move {
            let groups = vec![
                AdminGroupSummary {
                    id: String::from("group-1"),
                    organization_id: String::from("org-1"),
                    name: String::from("Core Admin"),
                    description: Some(String::from("Admin operators")),
                    created_at: String::from("2026-01-01T00:00:00Z"),
                    updated_at: String::from("2026-01-01T00:00:00Z"),
                    member_count: 2,
                },
                AdminGroupSummary {
                    id: String::from("group-2"),
                    organization_id: String::from("org-2"),
                    name: String::from("Support"),
                    description: None,
                    created_at: String::from("2026-01-02T00:00:00Z"),
                    updated_at: String::from("2026-01-02T00:00:00Z"),
                    member_count: 1,
                },
            ];

            let filtered = if let Some(organization_ids) = organization_ids {
                use std::collections::HashSet;
                let organization_id_set: HashSet<_> = organization_ids.into_iter().collect();
                groups
                    .into_iter()
                    .filter(|group| organization_id_set.contains(&group.organization_id))
                    .collect()
            } else {
                groups
            };

            Ok(filtered)
        })
    }

    fn get_group(
        &self,
        group_id: &str,
    ) -> BoxFuture<'_, Result<AdminGroupDetail, tearleads_data_access_traits::DataAccessError>>
    {
        let group_id = group_id.trim().to_string();

        Box::pin(async move {
            let groups = vec![
                AdminGroupDetail {
                    id: String::from("group-1"),
                    organization_id: String::from("org-1"),
                    name: String::from("Core Admin"),
                    description: Some(String::from("Admin operators")),
                    created_at: String::from("2026-01-01T00:00:00Z"),
                    updated_at: String::from("2026-01-01T00:00:00Z"),
                    members: vec![
                        AdminGroupMember {
                            user_id: String::from("user-1"),
                            email: String::from("admin@example.com"),
                            joined_at: String::from("2026-01-01T00:00:00Z"),
                        },
                        AdminGroupMember {
                            user_id: String::from("user-2"),
                            email: String::from("operator@example.com"),
                            joined_at: String::from("2026-01-02T00:00:00Z"),
                        },
                    ],
                },
                AdminGroupDetail {
                    id: String::from("group-2"),
                    organization_id: String::from("org-2"),
                    name: String::from("Support"),
                    description: None,
                    created_at: String::from("2026-01-02T00:00:00Z"),
                    updated_at: String::from("2026-01-02T00:00:00Z"),
                    members: vec![AdminGroupMember {
                        user_id: String::from("user-3"),
                        email: String::from("support@example.com"),
                        joined_at: String::from("2026-01-03T00:00:00Z"),
                    }],
                },
            ];

            groups
                .into_iter()
                .find(|group| group.id == group_id)
                .ok_or_else(|| {
                    DataAccessError::new(
                        DataAccessErrorKind::NotFound,
                        format!("group not found: {group_id}"),
                    )
                })
        })
    }

    fn list_organizations(
        &self,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<
        '_,
        Result<Vec<AdminOrganizationSummary>, tearleads_data_access_traits::DataAccessError>,
    > {
        Box::pin(async move {
            let organizations = vec![
                AdminOrganizationSummary {
                    id: String::from("org-1"),
                    name: String::from("Organization 1"),
                    description: Some(String::from("Primary organization")),
                    created_at: String::from("2026-01-01T00:00:00Z"),
                    updated_at: String::from("2026-01-01T00:00:00Z"),
                },
                AdminOrganizationSummary {
                    id: String::from("org-2"),
                    name: String::from("Organization 2"),
                    description: None,
                    created_at: String::from("2026-01-02T00:00:00Z"),
                    updated_at: String::from("2026-01-02T00:00:00Z"),
                },
            ];

            let filtered = if let Some(organization_ids) = organization_ids {
                use std::collections::HashSet;
                let organization_id_set: HashSet<_> = organization_ids.into_iter().collect();
                organizations
                    .into_iter()
                    .filter(|organization| organization_id_set.contains(&organization.id))
                    .collect()
            } else {
                organizations
            };

            Ok(filtered)
        })
    }

    fn list_users(
        &self,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminUserSummary>, tearleads_data_access_traits::DataAccessError>>
    {
        Box::pin(async move {
            let users = vec![
                AdminUserSummary {
                    id: String::from("user-1"),
                    email: String::from("admin@example.com"),
                    email_confirmed: true,
                    admin: true,
                    organization_ids: vec![String::from("org-1")],
                    created_at: Some(String::from("2026-01-01T00:00:00Z")),
                    last_active_at: Some(String::from("2026-01-04T00:00:00Z")),
                    accounting: AdminUserAccountingSummary {
                        total_prompt_tokens: 120,
                        total_completion_tokens: 40,
                        total_tokens: 160,
                        request_count: 12,
                        last_used_at: Some(String::from("2026-01-04T00:00:00Z")),
                    },
                    disabled: false,
                    disabled_at: None,
                    disabled_by: None,
                    marked_for_deletion_at: None,
                    marked_for_deletion_by: None,
                },
                AdminUserSummary {
                    id: String::from("user-2"),
                    email: String::from("operator@example.com"),
                    email_confirmed: true,
                    admin: false,
                    organization_ids: vec![String::from("org-2")],
                    created_at: Some(String::from("2026-01-02T00:00:00Z")),
                    last_active_at: None,
                    accounting: AdminUserAccountingSummary {
                        total_prompt_tokens: 0,
                        total_completion_tokens: 0,
                        total_tokens: 0,
                        request_count: 0,
                        last_used_at: None,
                    },
                    disabled: false,
                    disabled_at: None,
                    disabled_by: None,
                    marked_for_deletion_at: None,
                    marked_for_deletion_by: None,
                },
            ];

            let filtered = if let Some(organization_ids) = organization_ids {
                use std::collections::HashSet;
                let organization_id_set: HashSet<_> = organization_ids.into_iter().collect();
                users
                    .into_iter()
                    .filter(|user| {
                        user.organization_ids
                            .iter()
                            .any(|organization_id| organization_id_set.contains(organization_id))
                    })
                    .collect()
            } else {
                users
            };

            Ok(filtered)
        })
    }

    fn get_user(
        &self,
        user_id: &str,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Option<AdminUserSummary>, DataAccessError>> {
        let user_id = user_id.to_string();
        Box::pin(async move {
            let users = StaticPostgresRepository
                .list_users(organization_ids)
                .await?;
            Ok(users.into_iter().find(|user| user.id == user_id))
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

    fn list_rows(
        &self,
        _query: PostgresRowsQuery,
    ) -> BoxFuture<'_, Result<PostgresRowsPage, tearleads_data_access_traits::DataAccessError>>
    {
        Box::pin(async move {
            Ok(PostgresRowsPage {
                rows_json: vec![String::from(
                    "{\"id\":\"user-1\",\"email\":\"user@example.com\"}",
                )],
                total_count: 1,
                limit: 50,
                offset: 0,
            })
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct StaticRedisRepository;

impl RedisAdminRepository for StaticRedisRepository {
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

    fn delete_key(
        &self,
        _key: &str,
    ) -> BoxFuture<'_, Result<bool, tearleads_data_access_traits::DataAccessError>> {
        Box::pin(async move { Ok(true) })
    }

    fn get_db_size(
        &self,
    ) -> BoxFuture<'_, Result<u64, tearleads_data_access_traits::DataAccessError>> {
        Box::pin(async move { Ok(1) })
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
#[allow(clippy::expect_used)]
mod tests;

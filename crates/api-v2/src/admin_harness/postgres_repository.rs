use tearleads_data_access_traits::{
    AdminCreateGroupInput, AdminCreateOrganizationInput, AdminGroupDetail, AdminGroupSummary,
    AdminOrganizationSummary, AdminOrganizationUserSummary, AdminScopeOrganization,
    AdminUpdateGroupInput, AdminUpdateOrganizationInput, AdminUpdateUserInput, AdminUserSummary,
    BoxFuture, DataAccessError, DataAccessErrorKind, PostgresAdminReadRepository,
    PostgresConnectionInfo, PostgresInfoSnapshot, PostgresRowsPage, PostgresRowsQuery,
    PostgresTableInfo,
};

mod fixtures;

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
        Box::pin(async move { Ok(fixtures::scope_organizations()) })
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
            let groups = fixtures::group_summaries();

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
            let groups = fixtures::group_details();

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

    fn create_group(
        &self,
        input: AdminCreateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetail, DataAccessError>> {
        Box::pin(async move {
            if input.organization_id == "org-missing" {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::NotFound,
                    "organization not found: org-missing",
                ));
            }
            if input.name == "duplicate-group-name" {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::InvalidInput,
                    "group name already exists",
                ));
            }

            Ok(AdminGroupDetail {
                id: String::from("group-created"),
                organization_id: input.organization_id,
                name: input.name,
                description: input.description,
                created_at: String::from("2026-01-05T00:00:00Z"),
                updated_at: String::from("2026-01-05T00:00:00Z"),
                members: vec![],
            })
        })
    }

    fn update_group(
        &self,
        group_id: &str,
        input: AdminUpdateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetail, DataAccessError>> {
        let group_id = group_id.to_string();
        Box::pin(async move {
            let mut existing_group = StaticPostgresRepository.get_group(&group_id).await?;
            existing_group.name = input.name.unwrap_or(existing_group.name);
            if let Some(organization_id) = input.organization_id {
                existing_group.organization_id = organization_id;
            }
            if let Some(description) = input.description {
                existing_group.description = description;
            }
            existing_group.updated_at = String::from("2026-01-05T00:00:00Z");
            Ok(existing_group)
        })
    }

    fn delete_group(&self, group_id: &str) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let group_id = group_id.to_string();
        Box::pin(async move {
            let _ = StaticPostgresRepository.get_group(&group_id).await?;
            Ok(true)
        })
    }

    fn add_group_member(
        &self,
        group_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let group_id = group_id.to_string();
        let user_id = user_id.to_string();
        Box::pin(async move {
            let _ = StaticPostgresRepository.get_group(&group_id).await?;
            if user_id == "user-missing" {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::NotFound,
                    "user not found: user-missing",
                ));
            }
            if user_id == "user-duplicate" {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::InvalidInput,
                    "user is already a member of this group",
                ));
            }
            Ok(true)
        })
    }

    fn remove_group_member(
        &self,
        group_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let group_id = group_id.to_string();
        let user_id = user_id.to_string();
        Box::pin(async move {
            let _ = StaticPostgresRepository.get_group(&group_id).await?;
            Ok(user_id != "user-not-member")
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
            let organizations = fixtures::organization_summaries();

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

    fn create_organization(
        &self,
        input: AdminCreateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationSummary, DataAccessError>> {
        Box::pin(async move {
            if input.name == "duplicate-organization-name" {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::InvalidInput,
                    "organization name already exists",
                ));
            }

            Ok(AdminOrganizationSummary {
                id: String::from("org-created"),
                name: input.name,
                description: input.description,
                created_at: String::from("2026-01-05T00:00:00Z"),
                updated_at: String::from("2026-01-05T00:00:00Z"),
            })
        })
    }

    fn update_organization(
        &self,
        organization_id: &str,
        input: AdminUpdateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationSummary, DataAccessError>> {
        let organization_id = organization_id.to_string();
        Box::pin(async move {
            let mut organization = StaticPostgresRepository
                .list_organizations(None)
                .await?
                .into_iter()
                .find(|candidate| candidate.id == organization_id)
                .ok_or_else(|| {
                    DataAccessError::new(
                        DataAccessErrorKind::NotFound,
                        format!("organization not found: {organization_id}"),
                    )
                })?;

            organization.name = input.name.unwrap_or(organization.name);
            if let Some(description) = input.description {
                organization.description = description;
            }
            organization.updated_at = String::from("2026-01-05T00:00:00Z");
            Ok(organization)
        })
    }

    fn delete_organization(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let organization_id = organization_id.to_string();
        Box::pin(async move {
            let exists = StaticPostgresRepository
                .list_organizations(None)
                .await?
                .into_iter()
                .any(|organization| organization.id == organization_id);
            Ok(exists)
        })
    }

    fn get_organization_users(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationUserSummary>, DataAccessError>> {
        let organization_id = organization_id.to_string();
        Box::pin(async move {
            let users = StaticPostgresRepository
                .list_users(Some(vec![organization_id]))
                .await?;
            Ok(users
                .into_iter()
                .map(|user| AdminOrganizationUserSummary {
                    id: user.id,
                    email: user.email,
                    joined_at: user.created_at.unwrap_or_default(),
                })
                .collect())
        })
    }

    fn list_users(
        &self,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminUserSummary>, tearleads_data_access_traits::DataAccessError>>
    {
        Box::pin(async move {
            let users = fixtures::user_summaries();

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

    fn update_user(
        &self,
        user_id: &str,
        input: AdminUpdateUserInput,
    ) -> BoxFuture<'_, Result<AdminUserSummary, DataAccessError>> {
        let user_id = user_id.to_string();
        Box::pin(async move {
            if matches!(input.email.as_deref(), Some("duplicate@example.com")) {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::InvalidInput,
                    "email already exists",
                ));
            }

            let mut user = StaticPostgresRepository
                .get_user(&user_id, None)
                .await?
                .ok_or_else(|| {
                    DataAccessError::new(
                        DataAccessErrorKind::NotFound,
                        format!("user not found: {user_id}"),
                    )
                })?;

            if let Some(email) = input.email {
                user.email = email;
            }
            if let Some(email_confirmed) = input.email_confirmed {
                user.email_confirmed = email_confirmed;
            }
            if let Some(admin) = input.admin {
                user.admin = admin;
            }
            if let Some(organization_ids) = input.organization_ids {
                user.organization_ids = organization_ids;
            }
            if let Some(disabled) = input.disabled {
                user.disabled = disabled;
                if disabled {
                    user.disabled_at = Some(String::from("2026-01-05T00:00:00Z"));
                    user.disabled_by = Some(String::from("admin-root"));
                } else {
                    user.disabled_at = None;
                    user.disabled_by = None;
                }
            }
            if let Some(marked_for_deletion) = input.marked_for_deletion {
                if marked_for_deletion {
                    user.marked_for_deletion_at = Some(String::from("2026-01-05T00:00:00Z"));
                    user.marked_for_deletion_by = Some(String::from("admin-root"));
                } else {
                    user.marked_for_deletion_at = None;
                    user.marked_for_deletion_by = None;
                }
            }

            Ok(user)
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

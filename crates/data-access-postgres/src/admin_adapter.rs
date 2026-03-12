//! Adapter that maps gateway records to shared Postgres admin read models.

use tearleads_data_access_traits::{
    AdminCreateGroupInput, AdminCreateOrganizationInput, AdminGroupDetail, AdminGroupMember,
    AdminGroupSummary, AdminOrganizationSummary, AdminOrganizationUserSummary,
    AdminScopeOrganization, AdminUpdateGroupInput, AdminUpdateOrganizationInput,
    AdminUpdateUserInput, AdminUserAccountingSummary, AdminUserSummary, BoxFuture, DataAccessError,
    DataAccessErrorKind, PostgresAdminRepository, PostgresColumnInfo, PostgresInfoSnapshot,
    PostgresRowsPage, PostgresRowsQuery, PostgresTableInfo,
};

use crate::{
    AdminGroupDetailRecord, AdminGroupSummaryRecord, AdminOrganizationRecord,
    AdminOrganizationUserRecord, AdminScopeOrganizationRecord, AdminUserRecord,
    PostgresAdminGateway, PostgresRowsPageRecord,
};

/// Postgres repository implementation over a driver-specific gateway.
#[derive(Clone)]
pub struct PostgresAdminAdapter<G> {
    gateway: G,
}

impl<G> PostgresAdminAdapter<G> {
    /// Builds an adapter around a gateway implementation.
    pub fn new(gateway: G) -> Self {
        Self { gateway }
    }
}

impl<G> PostgresAdminRepository for PostgresAdminAdapter<G>
where
    G: PostgresAdminGateway + Send + Sync,
{
    fn get_postgres_info(&self) -> BoxFuture<'_, Result<PostgresInfoSnapshot, DataAccessError>> {
        Box::pin(async move {
            let server_version = self.gateway.fetch_server_version().await?;
            Ok(PostgresInfoSnapshot {
                connection: self.gateway.connection_info(),
                server_version,
            })
        })
    }

    fn list_scope_organizations(
        &self,
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganization>, DataAccessError>> {
        Box::pin(async move {
            let organizations = self.gateway.list_scope_organizations().await?;
            Ok(map_scope_organizations(organizations))
        })
    }

    fn list_scope_organizations_by_ids(
        &self,
        organization_ids: Vec<String>,
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganization>, DataAccessError>> {
        Box::pin(async move {
            let organizations = self
                .gateway
                .list_scope_organizations_by_ids(&organization_ids)
                .await?;
            Ok(map_scope_organizations(organizations))
        })
    }

    fn list_groups(
        &self,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminGroupSummary>, DataAccessError>> {
        Box::pin(async move {
            let groups = self
                .gateway
                .list_groups(organization_ids.as_deref())
                .await?;
            Ok(map_groups(groups))
        })
    }

    fn get_group(
        &self,
        group_id: &str,
    ) -> BoxFuture<'_, Result<AdminGroupDetail, DataAccessError>> {
        let group_id = group_id.to_string();

        Box::pin(async move {
            let group = self.gateway.get_group(&group_id).await?;
            Ok(map_group_detail(group))
        })
    }

    fn create_group(
        &self,
        input: AdminCreateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetail, DataAccessError>> {
        Box::pin(async move {
            let group = self.gateway.create_group(input).await?;
            Ok(map_group_detail(group))
        })
    }

    fn update_group(
        &self,
        group_id: &str,
        input: AdminUpdateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetail, DataAccessError>> {
        let group_id = group_id.to_string();
        Box::pin(async move {
            let group = self.gateway.update_group(&group_id, input).await?;
            Ok(map_group_detail(group))
        })
    }

    fn delete_group(&self, group_id: &str) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let group_id = group_id.to_string();
        Box::pin(async move { self.gateway.delete_group(&group_id).await })
    }

    fn add_group_member(
        &self,
        group_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let group_id = group_id.to_string();
        let user_id = user_id.to_string();
        Box::pin(async move { self.gateway.add_group_member(&group_id, &user_id).await })
    }

    fn remove_group_member(
        &self,
        group_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let group_id = group_id.to_string();
        let user_id = user_id.to_string();
        Box::pin(async move { self.gateway.remove_group_member(&group_id, &user_id).await })
    }

    fn list_organizations(
        &self,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationSummary>, DataAccessError>> {
        Box::pin(async move {
            let organizations = self
                .gateway
                .list_organizations(organization_ids.as_deref())
                .await?;
            Ok(map_organizations(organizations))
        })
    }

    fn create_organization(
        &self,
        input: AdminCreateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationSummary, DataAccessError>> {
        Box::pin(async move {
            let organization = self.gateway.create_organization(input).await?;
            Ok(map_organization(organization))
        })
    }

    fn update_organization(
        &self,
        organization_id: &str,
        input: AdminUpdateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationSummary, DataAccessError>> {
        let organization_id = organization_id.to_string();
        Box::pin(async move {
            let organization = self
                .gateway
                .update_organization(&organization_id, input)
                .await?;
            Ok(map_organization(organization))
        })
    }

    fn delete_organization(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let organization_id = organization_id.to_string();
        Box::pin(async move { self.gateway.delete_organization(&organization_id).await })
    }

    fn get_organization_users(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationUserSummary>, DataAccessError>> {
        let organization_id = organization_id.to_string();
        Box::pin(async move {
            let users = self
                .gateway
                .get_organization_users(&organization_id)
                .await?;
            Ok(map_organization_users(users))
        })
    }

    fn list_users(
        &self,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Vec<AdminUserSummary>, DataAccessError>> {
        Box::pin(async move {
            let users = self.gateway.list_users(organization_ids.as_deref()).await?;
            Ok(map_users(users))
        })
    }

    fn get_user(
        &self,
        user_id: &str,
        organization_ids: Option<Vec<String>>,
    ) -> BoxFuture<'_, Result<Option<AdminUserSummary>, DataAccessError>> {
        let user_id = user_id.to_string();
        Box::pin(async move {
            let user = self
                .gateway
                .get_user(&user_id, organization_ids.as_deref())
                .await?;
            Ok(user.map(map_user))
        })
    }

    fn update_user(
        &self,
        user_id: &str,
        input: AdminUpdateUserInput,
    ) -> BoxFuture<'_, Result<AdminUserSummary, DataAccessError>> {
        let user_id = user_id.to_string();
        Box::pin(async move {
            let user = self.gateway.update_user(&user_id, input).await?;
            Ok(map_user(user))
        })
    }

    fn list_tables(&self) -> BoxFuture<'_, Result<Vec<PostgresTableInfo>, DataAccessError>> {
        Box::pin(async move {
            let records = self.gateway.list_tables().await?;
            let tables = records
                .into_iter()
                .map(|record| PostgresTableInfo {
                    schema: record.schema,
                    name: record.name,
                    row_count: record.row_count,
                    total_bytes: record.total_bytes,
                    table_bytes: record.table_bytes,
                    index_bytes: record.index_bytes,
                })
                .collect();
            Ok(tables)
        })
    }

    fn list_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> BoxFuture<'_, Result<Vec<PostgresColumnInfo>, DataAccessError>> {
        let schema = schema.to_string();
        let table = table.to_string();

        Box::pin(async move {
            let exists = self.gateway.table_exists(&schema, &table).await?;
            if !exists {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::NotFound,
                    format!("table not found: {schema}.{table}"),
                ));
            }

            let records = self.gateway.list_columns(&schema, &table).await?;
            let columns = records
                .into_iter()
                .map(|record| PostgresColumnInfo {
                    name: record.name,
                    data_type: record.data_type,
                    nullable: record.nullable,
                    default_value: record.default_value,
                    ordinal_position: record.ordinal_position,
                })
                .collect();
            Ok(columns)
        })
    }

    fn list_rows(
        &self,
        query: PostgresRowsQuery,
    ) -> BoxFuture<'_, Result<PostgresRowsPage, DataAccessError>> {
        Box::pin(async move {
            let page = self.gateway.list_rows(&query).await?;
            Ok(map_rows_page(page))
        })
    }
}

fn map_scope_organizations(
    records: Vec<AdminScopeOrganizationRecord>,
) -> Vec<AdminScopeOrganization> {
    records
        .into_iter()
        .map(|record| AdminScopeOrganization {
            id: record.id,
            name: record.name,
        })
        .collect()
}

fn map_groups(records: Vec<AdminGroupSummaryRecord>) -> Vec<AdminGroupSummary> {
    records
        .into_iter()
        .map(|record| AdminGroupSummary {
            id: record.id,
            organization_id: record.organization_id,
            name: record.name,
            description: record.description,
            created_at: record.created_at,
            updated_at: record.updated_at,
            member_count: record.member_count,
        })
        .collect()
}

fn map_group_detail(record: AdminGroupDetailRecord) -> AdminGroupDetail {
    AdminGroupDetail {
        id: record.id,
        organization_id: record.organization_id,
        name: record.name,
        description: record.description,
        created_at: record.created_at,
        updated_at: record.updated_at,
        members: record
            .members
            .into_iter()
            .map(|member| AdminGroupMember {
                user_id: member.user_id,
                email: member.email,
                joined_at: member.joined_at,
            })
            .collect(),
    }
}

fn map_organizations(records: Vec<AdminOrganizationRecord>) -> Vec<AdminOrganizationSummary> {
    records.into_iter().map(map_organization).collect()
}

fn map_organization(record: AdminOrganizationRecord) -> AdminOrganizationSummary {
    AdminOrganizationSummary {
        id: record.id,
        name: record.name,
        description: record.description,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

fn map_organization_users(
    records: Vec<AdminOrganizationUserRecord>,
) -> Vec<AdminOrganizationUserSummary> {
    records
        .into_iter()
        .map(|record| AdminOrganizationUserSummary {
            id: record.id,
            email: record.email,
            joined_at: record.joined_at,
        })
        .collect()
}

fn map_users(records: Vec<AdminUserRecord>) -> Vec<AdminUserSummary> {
    records.into_iter().map(map_user).collect()
}

fn map_user(record: AdminUserRecord) -> AdminUserSummary {
    AdminUserSummary {
        id: record.id,
        email: record.email,
        email_confirmed: record.email_confirmed,
        admin: record.admin,
        organization_ids: record.organization_ids,
        created_at: record.created_at,
        last_active_at: record.last_active_at,
        accounting: AdminUserAccountingSummary {
            total_prompt_tokens: record.accounting.total_prompt_tokens,
            total_completion_tokens: record.accounting.total_completion_tokens,
            total_tokens: record.accounting.total_tokens,
            request_count: record.accounting.request_count,
            last_used_at: record.accounting.last_used_at,
        },
        disabled: record.disabled,
        disabled_at: record.disabled_at,
        disabled_by: record.disabled_by,
        marked_for_deletion_at: record.marked_for_deletion_at,
        marked_for_deletion_by: record.marked_for_deletion_by,
    }
}

fn map_rows_page(record: PostgresRowsPageRecord) -> PostgresRowsPage {
    PostgresRowsPage {
        rows_json: record.rows_json,
        total_count: record.total_count,
        limit: record.limit,
        offset: record.offset,
    }
}

#[cfg(test)]
mod tests;

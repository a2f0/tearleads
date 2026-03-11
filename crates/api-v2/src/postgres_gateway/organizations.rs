use chrono::{DateTime, Utc};
use tearleads_data_access_postgres::{
    AdminOrganizationRecord, AdminOrganizationUserRecord, AdminScopeOrganizationRecord,
};
use tearleads_data_access_traits::{
    AdminCreateOrganizationInput, AdminUpdateOrganizationInput, BoxFuture, DataAccessError,
    DataAccessErrorKind,
};

use super::TokioPostgresGateway;
use super::error::{pool_error, query_error};

fn to_rfc3339(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339()
}

impl TokioPostgresGateway {
    pub(super) fn list_scope_organizations_impl(
        &self,
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganizationRecord>, DataAccessError>> {
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let rows = client
                .query(
                    "SELECT id, name FROM organizations ORDER BY name",
                    &[],
                )
                .await
                .map_err(query_error)?;
            Ok(rows
                .into_iter()
                .map(|row| AdminScopeOrganizationRecord {
                    id: row.get("id"),
                    name: row.get("name"),
                })
                .collect())
        })
    }

    pub(super) fn list_scope_organizations_by_ids_impl(
        &self,
        organization_ids: &[String],
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganizationRecord>, DataAccessError>> {
        let ids = organization_ids.to_vec();
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let rows = client
                .query(
                    "SELECT id, name FROM organizations WHERE id = ANY($1::text[]) ORDER BY name",
                    &[&ids],
                )
                .await
                .map_err(query_error)?;
            Ok(rows
                .into_iter()
                .map(|row| AdminScopeOrganizationRecord {
                    id: row.get("id"),
                    name: row.get("name"),
                })
                .collect())
        })
    }

    pub(super) fn list_organizations_impl(
        &self,
        organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationRecord>, DataAccessError>> {
        let owned_ids = organization_ids.map(|s| s.to_vec());
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;

            let rows = match owned_ids.as_deref() {
                Some(ids) => {
                    client
                        .query(
                            "SELECT id, name, description, created_at, updated_at
                             FROM organizations
                             WHERE id = ANY($1::text[])
                             ORDER BY name",
                            &[&ids],
                        )
                        .await
                        .map_err(query_error)?
                }
                None => {
                    client
                        .query(
                            "SELECT id, name, description, created_at, updated_at
                             FROM organizations
                             ORDER BY name",
                            &[],
                        )
                        .await
                        .map_err(query_error)?
                }
            };

            Ok(rows.into_iter().map(map_org_row).collect())
        })
    }

    pub(super) fn create_organization_impl(
        &self,
        input: AdminCreateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationRecord, DataAccessError>> {
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let org_id = super::groups::uuid_v4();
            let now = Utc::now();
            let rc_app_user_id = format!("org_{org_id}");

            let rows = client
                .query(
                    "WITH inserted_org AS (
                        INSERT INTO organizations (id, name, description, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $4)
                        RETURNING id, name, description, created_at, updated_at
                    ),
                    inserted_billing AS (
                        INSERT INTO organization_billing_accounts (
                            organization_id,
                            revenuecat_app_user_id,
                            entitlement_status,
                            created_at,
                            updated_at
                        )
                        SELECT id, $5, 'inactive', $4, $4
                        FROM inserted_org
                    )
                    SELECT id, name, description, created_at, updated_at
                    FROM inserted_org",
                    &[&org_id, &input.name, &input.description, &now, &rc_app_user_id],
                )
                .await
                .map_err(query_error)?;

            rows.into_iter().next().map(map_org_row).ok_or_else(|| {
                DataAccessError::new(
                    DataAccessErrorKind::Internal,
                    "create organization returned no rows",
                )
            })
        })
    }

    pub(super) fn update_organization_impl(
        &self,
        organization_id: &str,
        input: AdminUpdateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationRecord, DataAccessError>> {
        let organization_id = organization_id.to_string();
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;

            let mut set_clauses = vec!["updated_at = NOW()".to_string()];
            let mut params: Vec<Box<dyn tokio_postgres::types::ToSql + Sync + Send>> = Vec::new();
            let mut idx = 1u32;

            if let Some(ref name) = input.name {
                params.push(Box::new(name.clone()));
                set_clauses.push(format!("name = ${idx}"));
                idx += 1;
            }
            if let Some(ref desc) = input.description {
                match desc {
                    Some(val) => {
                        params.push(Box::new(val.clone()));
                        set_clauses.push(format!("description = ${idx}"));
                    }
                    None => {
                        params.push(Box::new(None::<String>));
                        set_clauses.push(format!("description = ${idx}"));
                    }
                }
                idx += 1;
            }

            params.push(Box::new(organization_id.clone()));
            let set_sql = set_clauses.join(", ");
            let sql = format!(
                "UPDATE organizations SET {set_sql} WHERE id = ${idx}
                 RETURNING id, name, description, created_at, updated_at"
            );
            let param_refs: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
                params.iter().map(|p| &**p as &(dyn tokio_postgres::types::ToSql + Sync)).collect();
            let rows = client.query(&sql, &param_refs).await.map_err(query_error)?;

            rows.into_iter().next().map(map_org_row).ok_or_else(|| {
                DataAccessError::new(
                    DataAccessErrorKind::NotFound,
                    format!("organization not found: {organization_id}"),
                )
            })
        })
    }

    pub(super) fn delete_organization_impl(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let organization_id = organization_id.to_string();
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let count = client
                .execute(
                    "DELETE FROM organizations WHERE id = $1",
                    &[&organization_id],
                )
                .await
                .map_err(query_error)?;
            Ok(count > 0)
        })
    }

    pub(super) fn get_organization_users_impl(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationUserRecord>, DataAccessError>> {
        let organization_id = organization_id.to_string();
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;

            let exists = client
                .query(
                    "SELECT id FROM organizations WHERE id = $1",
                    &[&organization_id],
                )
                .await
                .map_err(query_error)?;

            if exists.is_empty() {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::NotFound,
                    format!("organization not found: {organization_id}"),
                ));
            }

            let rows = client
                .query(
                    "SELECT u.id, u.email, uo.joined_at
                     FROM users u
                     INNER JOIN user_organizations uo ON uo.user_id = u.id
                     WHERE uo.organization_id = $1
                     ORDER BY u.email",
                    &[&organization_id],
                )
                .await
                .map_err(query_error)?;

            Ok(rows
                .into_iter()
                .map(|row| {
                    let joined_at: DateTime<Utc> = row.get("joined_at");
                    AdminOrganizationUserRecord {
                        id: row.get("id"),
                        email: row.get("email"),
                        joined_at: to_rfc3339(joined_at),
                    }
                })
                .collect())
        })
    }
}

fn map_org_row(row: tokio_postgres::Row) -> AdminOrganizationRecord {
    let created_at: DateTime<Utc> = row.get("created_at");
    let updated_at: DateTime<Utc> = row.get("updated_at");
    AdminOrganizationRecord {
        id: row.get("id"),
        name: row.get("name"),
        description: row.get("description"),
        created_at: to_rfc3339(created_at),
        updated_at: to_rfc3339(updated_at),
    }
}

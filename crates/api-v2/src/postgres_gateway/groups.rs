use chrono::{DateTime, Utc};
use tearleads_data_access_postgres::{
    AdminGroupDetailRecord, AdminGroupMemberRecord, AdminGroupSummaryRecord,
};
use tearleads_data_access_traits::{
    AdminCreateGroupInput, AdminUpdateGroupInput, BoxFuture, DataAccessError,
    DataAccessErrorKind,
};

use super::TokioPostgresGateway;
use super::error::{pool_error, query_error};

fn to_rfc3339(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339()
}

impl TokioPostgresGateway {
    pub(super) fn list_groups_impl(
        &self,
        organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Vec<AdminGroupSummaryRecord>, DataAccessError>> {
        let owned_ids = organization_ids.map(|s| s.to_vec());
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;

            let rows = match owned_ids.as_deref() {
                Some(ids) => {
                    client
                        .query(
                            "SELECT
                                g.id,
                                g.organization_id,
                                g.name,
                                g.description,
                                g.created_at,
                                g.updated_at,
                                COUNT(ug.user_id)::bigint AS member_count
                            FROM groups g
                            LEFT JOIN user_groups ug ON ug.group_id = g.id
                            WHERE g.organization_id = ANY($1::text[])
                            GROUP BY g.id
                            ORDER BY g.name",
                            &[&ids],
                        )
                        .await
                        .map_err(query_error)?
                }
                None => {
                    client
                        .query(
                            "SELECT
                                g.id,
                                g.organization_id,
                                g.name,
                                g.description,
                                g.created_at,
                                g.updated_at,
                                COUNT(ug.user_id)::bigint AS member_count
                            FROM groups g
                            LEFT JOIN user_groups ug ON ug.group_id = g.id
                            GROUP BY g.id
                            ORDER BY g.name",
                            &[],
                        )
                        .await
                        .map_err(query_error)?
                }
            };

            Ok(rows.into_iter().map(map_group_summary_row).collect())
        })
    }

    pub(super) fn get_group_impl(
        &self,
        group_id: &str,
    ) -> BoxFuture<'_, Result<AdminGroupDetailRecord, DataAccessError>> {
        let group_id = group_id.to_string();
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;

            let rows = client
                .query(
                    "SELECT
                        g.id,
                        g.organization_id,
                        g.name,
                        g.description,
                        g.created_at,
                        g.updated_at,
                        ug.user_id,
                        u.email,
                        ug.joined_at
                    FROM groups g
                    LEFT JOIN user_groups ug ON ug.group_id = g.id
                    LEFT JOIN users u ON u.id = ug.user_id
                    WHERE g.id = $1
                    ORDER BY ug.joined_at",
                    &[&group_id],
                )
                .await
                .map_err(query_error)?;

            let first = rows.first().ok_or_else(|| {
                DataAccessError::new(
                    DataAccessErrorKind::NotFound,
                    format!("group not found: {group_id}"),
                )
            })?;

            let created_at: DateTime<Utc> = first.get("created_at");
            let updated_at: DateTime<Utc> = first.get("updated_at");

            let members: Vec<AdminGroupMemberRecord> = rows
                .iter()
                .filter_map(|row| {
                    let user_id: Option<String> = row.get("user_id");
                    user_id.map(|uid| {
                        let joined_at: DateTime<Utc> = row.get("joined_at");
                        AdminGroupMemberRecord {
                            user_id: uid,
                            email: row.get("email"),
                            joined_at: to_rfc3339(joined_at),
                        }
                    })
                })
                .collect();

            Ok(AdminGroupDetailRecord {
                id: first.get("id"),
                organization_id: first.get("organization_id"),
                name: first.get("name"),
                description: first.get("description"),
                created_at: to_rfc3339(created_at),
                updated_at: to_rfc3339(updated_at),
                members,
            })
        })
    }

    pub(super) fn create_group_impl(
        &self,
        input: AdminCreateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetailRecord, DataAccessError>> {
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let group_id = uuid_v4();
            let now = Utc::now();

            client
                .execute(
                    "INSERT INTO groups (id, organization_id, name, description, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6)",
                    &[
                        &group_id,
                        &input.organization_id,
                        &input.name,
                        &input.description,
                        &now,
                        &now,
                    ],
                )
                .await
                .map_err(query_error)?;

            Ok(AdminGroupDetailRecord {
                id: group_id,
                organization_id: input.organization_id,
                name: input.name,
                description: input.description,
                created_at: to_rfc3339(now),
                updated_at: to_rfc3339(now),
                members: Vec::new(),
            })
        })
    }

    pub(super) fn update_group_impl(
        &self,
        group_id: &str,
        input: AdminUpdateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetailRecord, DataAccessError>> {
        let group_id = group_id.to_string();
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
            if let Some(ref org_id) = input.organization_id {
                params.push(Box::new(org_id.clone()));
                set_clauses.push(format!("organization_id = ${idx}"));
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

            params.push(Box::new(group_id.clone()));
            let set_sql = set_clauses.join(", ");
            let sql = format!("UPDATE groups SET {set_sql} WHERE id = ${idx}");
            let param_refs: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
                params.iter().map(|p| &**p as &(dyn tokio_postgres::types::ToSql + Sync)).collect();
            client.execute(&sql, &param_refs).await.map_err(query_error)?;

            self.get_group_impl(&group_id).await
        })
    }

    pub(super) fn delete_group_impl(
        &self,
        group_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let group_id = group_id.to_string();
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let count = client
                .execute("DELETE FROM groups WHERE id = $1", &[&group_id])
                .await
                .map_err(query_error)?;
            Ok(count > 0)
        })
    }

    pub(super) fn add_group_member_impl(
        &self,
        group_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let group_id = group_id.to_string();
        let user_id = user_id.to_string();
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;

            let org_rows = client
                .query(
                    "SELECT organization_id FROM groups WHERE id = $1",
                    &[&group_id],
                )
                .await
                .map_err(query_error)?;

            let org_id: String = org_rows
                .first()
                .ok_or_else(|| {
                    DataAccessError::new(
                        DataAccessErrorKind::NotFound,
                        format!("group not found: {group_id}"),
                    )
                })?
                .get("organization_id");

            let user_exists = client
                .query("SELECT 1 FROM users WHERE id = $1", &[&user_id])
                .await
                .map_err(query_error)?;

            if user_exists.is_empty() {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::NotFound,
                    format!("user not found: {user_id}"),
                ));
            }

            let now = Utc::now();
            client
                .execute(
                    "INSERT INTO user_organizations (user_id, organization_id, joined_at)
                     VALUES ($1, $2, $3)
                     ON CONFLICT DO NOTHING",
                    &[&user_id, &org_id, &now],
                )
                .await
                .map_err(query_error)?;

            let count = client
                .execute(
                    "INSERT INTO user_groups (user_id, group_id, joined_at) VALUES ($1, $2, $3)",
                    &[&user_id, &group_id, &now],
                )
                .await
                .map_err(query_error)?;

            Ok(count > 0)
        })
    }

    pub(super) fn remove_group_member_impl(
        &self,
        group_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let group_id = group_id.to_string();
        let user_id = user_id.to_string();
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let count = client
                .execute(
                    "DELETE FROM user_groups WHERE group_id = $1 AND user_id = $2",
                    &[&group_id, &user_id],
                )
                .await
                .map_err(query_error)?;
            Ok(count > 0)
        })
    }
}

fn map_group_summary_row(row: tokio_postgres::Row) -> AdminGroupSummaryRecord {
    let created_at: DateTime<Utc> = row.get("created_at");
    let updated_at: DateTime<Utc> = row.get("updated_at");
    AdminGroupSummaryRecord {
        id: row.get("id"),
        organization_id: row.get("organization_id"),
        name: row.get("name"),
        description: row.get("description"),
        created_at: to_rfc3339(created_at),
        updated_at: to_rfc3339(updated_at),
        member_count: row.get::<_, i64>("member_count") as u32,
    }
}

pub(super) fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let nanos = d.as_nanos();
    let rand_part: u64 = (nanos ^ (nanos >> 64) as u128) as u64;
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (nanos & 0xFFFF_FFFF) as u32,
        ((nanos >> 32) & 0xFFFF) as u16,
        (rand_part & 0xFFF) as u16,
        (0x8000 | (rand_part >> 12) & 0x3FFF) as u16,
        (rand_part >> 26) & 0xFFFF_FFFF_FFFF,
    )
}

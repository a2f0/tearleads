use chrono::{DateTime, Utc};
use tearleads_data_access_postgres::{AdminUserAccountingRecord, AdminUserRecord};
use tearleads_data_access_traits::{
    AdminUpdateUserInput, BoxFuture, DataAccessError, DataAccessErrorKind,
};

use super::TokioPostgresGateway;
use super::error::{pool_error, query_error};

fn opt_rfc3339(dt: Option<DateTime<Utc>>) -> Option<String> {
    dt.map(|d| d.to_rfc3339())
}

impl TokioPostgresGateway {
    pub(super) fn list_users_impl(
        &self,
        organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Vec<AdminUserRecord>, DataAccessError>> {
        let owned_ids = organization_ids.map(|s| s.to_vec());
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;

            let rows = match owned_ids.as_deref() {
                Some(ids) => {
                    client
                        .query(
                            "SELECT
                                u.id,
                                u.email,
                                u.email_confirmed,
                                u.admin,
                                u.disabled,
                                u.disabled_at,
                                u.disabled_by,
                                u.marked_for_deletion_at,
                                u.marked_for_deletion_by,
                                MIN(uc.created_at) AS created_at,
                                COALESCE(
                                    ARRAY_AGG(uo.organization_id) FILTER (
                                        WHERE uo.organization_id = ANY($1::text[])
                                    ),
                                    '{}'
                                ) AS organization_ids
                            FROM users u
                            LEFT JOIN user_organizations uo ON uo.user_id = u.id
                            LEFT JOIN user_credentials uc ON uc.user_id = u.id
                            WHERE EXISTS (
                                SELECT 1
                                FROM user_organizations uof
                                WHERE uof.user_id = u.id
                                    AND uof.organization_id = ANY($1::text[])
                            )
                            GROUP BY u.id
                            ORDER BY u.email",
                            &[&ids],
                        )
                        .await
                        .map_err(query_error)?
                }
                None => {
                    client
                        .query(
                            "SELECT
                                u.id,
                                u.email,
                                u.email_confirmed,
                                u.admin,
                                u.disabled,
                                u.disabled_at,
                                u.disabled_by,
                                u.marked_for_deletion_at,
                                u.marked_for_deletion_by,
                                MIN(uc.created_at) AS created_at,
                                COALESCE(
                                    ARRAY_AGG(uo.organization_id) FILTER (
                                        WHERE uo.organization_id IS NOT NULL
                                    ),
                                    '{}'
                                ) AS organization_ids
                            FROM users u
                            LEFT JOIN user_organizations uo ON uo.user_id = u.id
                            LEFT JOIN user_credentials uc ON uc.user_id = u.id
                            GROUP BY u.id
                            ORDER BY u.email",
                            &[],
                        )
                        .await
                        .map_err(query_error)?
                }
            };

            let user_ids: Vec<String> = rows.iter().map(|r| r.get::<_, String>("id")).collect();
            let accounting = self.fetch_accounting(&client, &user_ids).await?;

            let users = rows
                .into_iter()
                .map(|row| {
                    let id: String = row.get("id");
                    let acct = accounting
                        .iter()
                        .find(|a| a.0 == id)
                        .map(|a| a.1.clone())
                        .unwrap_or_default();
                    map_user_row(&row, acct)
                })
                .collect();
            Ok(users)
        })
    }

    pub(super) fn get_user_impl(
        &self,
        user_id: &str,
        organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Option<AdminUserRecord>, DataAccessError>> {
        let user_id = user_id.to_string();
        let owned_ids = organization_ids.map(|s| s.to_vec());
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;

            let rows = match owned_ids.as_deref() {
                Some(ids) => {
                    client
                        .query(
                            "SELECT
                                u.id,
                                u.email,
                                u.email_confirmed,
                                u.admin,
                                u.disabled,
                                u.disabled_at,
                                u.disabled_by,
                                u.marked_for_deletion_at,
                                u.marked_for_deletion_by,
                                MIN(uc.created_at) AS created_at,
                                COALESCE(
                                    ARRAY_AGG(uo.organization_id) FILTER (
                                        WHERE uo.organization_id = ANY($2::text[])
                                    ),
                                    '{}'
                                ) AS organization_ids
                            FROM users u
                            LEFT JOIN user_organizations uo ON uo.user_id = u.id
                            LEFT JOIN user_credentials uc ON uc.user_id = u.id
                            WHERE u.id = $1
                                AND EXISTS (
                                    SELECT 1
                                    FROM user_organizations uof
                                    WHERE uof.user_id = u.id
                                        AND uof.organization_id = ANY($2::text[])
                                )
                            GROUP BY u.id",
                            &[&user_id, &ids],
                        )
                        .await
                        .map_err(query_error)?
                }
                None => {
                    client
                        .query(
                            "SELECT
                                u.id,
                                u.email,
                                u.email_confirmed,
                                u.admin,
                                u.disabled,
                                u.disabled_at,
                                u.disabled_by,
                                u.marked_for_deletion_at,
                                u.marked_for_deletion_by,
                                MIN(uc.created_at) AS created_at,
                                COALESCE(
                                    ARRAY_AGG(uo.organization_id) FILTER (
                                        WHERE uo.organization_id IS NOT NULL
                                    ),
                                    '{}'
                                ) AS organization_ids
                            FROM users u
                            LEFT JOIN user_organizations uo ON uo.user_id = u.id
                            LEFT JOIN user_credentials uc ON uc.user_id = u.id
                            WHERE u.id = $1
                            GROUP BY u.id",
                            &[&user_id],
                        )
                        .await
                        .map_err(query_error)?
                }
            };

            let Some(row) = rows.into_iter().next() else {
                return Ok(None);
            };

            let acct = self
                .fetch_accounting(&client, &[user_id])
                .await?
                .into_iter()
                .next()
                .map(|a| a.1)
                .unwrap_or_default();

            Ok(Some(map_user_row(&row, acct)))
        })
    }

    pub(super) fn update_user_impl(
        &self,
        user_id: &str,
        input: AdminUpdateUserInput,
    ) -> BoxFuture<'_, Result<AdminUserRecord, DataAccessError>> {
        let user_id = user_id.to_string();
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;

            let mut set_clauses: Vec<String> = Vec::new();
            let mut params: Vec<Box<dyn tokio_postgres::types::ToSql + Sync + Send>> = Vec::new();
            let mut idx = 1u32;

            if let Some(ref email) = input.email {
                params.push(Box::new(email.clone()));
                set_clauses.push(format!("email = ${idx}"));
                idx += 1;
            }
            if let Some(email_confirmed) = input.email_confirmed {
                params.push(Box::new(email_confirmed));
                set_clauses.push(format!("email_confirmed = ${idx}"));
                idx += 1;
            }
            if let Some(admin) = input.admin {
                params.push(Box::new(admin));
                set_clauses.push(format!("admin = ${idx}"));
                idx += 1;
            }
            if let Some(disabled) = input.disabled {
                params.push(Box::new(disabled));
                set_clauses.push(format!("disabled = ${idx}"));
                idx += 1;
                if disabled {
                    set_clauses.push("disabled_at = NOW()".to_string());
                    params.push(Box::new(user_id.clone()));
                    set_clauses.push(format!("disabled_by = ${idx}"));
                    idx += 1;
                } else {
                    set_clauses.push("disabled_at = NULL".to_string());
                    set_clauses.push("disabled_by = NULL".to_string());
                }
            }
            if let Some(marked_for_deletion) = input.marked_for_deletion {
                if marked_for_deletion {
                    set_clauses.push("marked_for_deletion_at = NOW()".to_string());
                    params.push(Box::new(user_id.clone()));
                    set_clauses.push(format!("marked_for_deletion_by = ${idx}"));
                    idx += 1;
                } else {
                    set_clauses.push("marked_for_deletion_at = NULL".to_string());
                    set_clauses.push("marked_for_deletion_by = NULL".to_string());
                }
            }

            if !set_clauses.is_empty() {
                params.push(Box::new(user_id.clone()));
                let set_sql = set_clauses.join(", ");
                let sql = format!("UPDATE users SET {set_sql} WHERE id = ${idx}");
                let param_refs: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
                    params.iter().map(|p| &**p as &(dyn tokio_postgres::types::ToSql + Sync)).collect();
                client.execute(&sql, &param_refs).await.map_err(query_error)?;
            }

            if let Some(ref org_ids) = input.organization_ids {
                let personal_rows = client
                    .query(
                        "SELECT personal_organization_id FROM users WHERE id = $1",
                        &[&user_id],
                    )
                    .await
                    .map_err(query_error)?;

                let personal_org_id: Option<String> = personal_rows
                    .first()
                    .and_then(|r| r.get("personal_organization_id"));

                client
                    .execute(
                        "DELETE FROM user_organizations WHERE user_id = $1",
                        &[&user_id],
                    )
                    .await
                    .map_err(query_error)?;

                if !org_ids.is_empty() {
                    let personal = personal_org_id.unwrap_or_default();
                    client
                        .execute(
                            "INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
                             SELECT $1, organization_id, NOW(), organization_id = $3
                             FROM unnest($2::text[]) AS organization_id",
                            &[&user_id, &org_ids, &personal],
                        )
                        .await
                        .map_err(query_error)?;
                }
            }

            self.get_user_impl(&user_id, None)
                .await?
                .ok_or_else(|| {
                    DataAccessError::new(
                        DataAccessErrorKind::NotFound,
                        format!("user not found after update: {user_id}"),
                    )
                })
        })
    }

    pub(super) async fn fetch_accounting(
        &self,
        client: &deadpool_postgres::Client,
        user_ids: &[String],
    ) -> Result<Vec<(String, AdminUserAccountingRecord)>, DataAccessError> {
        if user_ids.is_empty() {
            return Ok(Vec::new());
        }

        let rows = client
            .query(
                "SELECT
                    user_id,
                    COALESCE(SUM(prompt_tokens), 0)::bigint AS total_prompt_tokens,
                    COALESCE(SUM(completion_tokens), 0)::bigint AS total_completion_tokens,
                    COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
                    COUNT(*)::bigint AS request_count,
                    MAX(created_at) AS last_used_at
                FROM ai_usage
                WHERE user_id = ANY($1::text[])
                GROUP BY user_id",
                &[&user_ids],
            )
            .await
            .map_err(query_error)?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let uid: String = row.get("user_id");
                let last_used_at: Option<DateTime<Utc>> = row.get("last_used_at");
                (
                    uid,
                    AdminUserAccountingRecord {
                        total_prompt_tokens: row.get::<_, i64>("total_prompt_tokens") as u64,
                        total_completion_tokens: row.get::<_, i64>("total_completion_tokens")
                            as u64,
                        total_tokens: row.get::<_, i64>("total_tokens") as u64,
                        request_count: row.get::<_, i64>("request_count") as u64,
                        last_used_at: opt_rfc3339(last_used_at),
                    },
                )
            })
            .collect())
    }
}

fn map_user_row(
    row: &tokio_postgres::Row,
    accounting: AdminUserAccountingRecord,
) -> AdminUserRecord {
    let created_at: Option<DateTime<Utc>> = row.get("created_at");
    let disabled_at: Option<DateTime<Utc>> = row.get("disabled_at");
    let marked_for_deletion_at: Option<DateTime<Utc>> = row.get("marked_for_deletion_at");
    let organization_ids: Vec<String> = row.get("organization_ids");

    AdminUserRecord {
        id: row.get("id"),
        email: row.get("email"),
        email_confirmed: row.get("email_confirmed"),
        admin: row.get("admin"),
        organization_ids,
        created_at: opt_rfc3339(created_at),
        last_active_at: None,
        accounting,
        disabled: row.get("disabled"),
        disabled_at: opt_rfc3339(disabled_at),
        disabled_by: row.get("disabled_by"),
        marked_for_deletion_at: opt_rfc3339(marked_for_deletion_at),
        marked_for_deletion_by: row.get("marked_for_deletion_by"),
    }
}

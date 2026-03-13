use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use tokio_postgres::types::ToSql;

use tearleads_data_access_traits::{
    AiRecordUsageInput, AiUsagePage, AiUsageQuery, AiUsageRecord, AiUsageSummary,
    AiUsageSummaryByModel, BoxFuture, DataAccessError, DataAccessErrorKind,
    PostgresAiUsageRepository,
};

use super::TokioPostgresGateway;
use super::error::{pool_error, query_error};
use super::groups::uuid_v4;

fn to_rfc3339(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339()
}

fn non_negative_i32_to_u64(value: i32) -> u64 {
    if value < 0 { 0 } else { value as u64 }
}

impl PostgresAiUsageRepository for TokioPostgresGateway {
    fn record_usage(
        &self,
        user_id: &str,
        input: AiRecordUsageInput,
    ) -> BoxFuture<'_, Result<AiUsageRecord, DataAccessError>> {
        let user_id = user_id.to_string();

        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let organization_id = client
                .query(
                    "SELECT organization_id FROM user_organizations WHERE user_id = $1 LIMIT 1",
                    &[&user_id],
                )
                .await
                .map_err(query_error)?
                .first()
                .and_then(|row| row.get::<_, Option<String>>("organization_id"));

            let id = uuid_v4();
            let now = Utc::now();

            let rows = client
                .query(
                    "INSERT INTO ai_usage (
                        id,
                        conversation_id,
                        message_id,
                        user_id,
                        organization_id,
                        model_id,
                        prompt_tokens,
                        completion_tokens,
                        total_tokens,
                        openrouter_request_id,
                        created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    RETURNING
                        id,
                        conversation_id,
                        message_id,
                        user_id,
                        organization_id,
                        model_id,
                        prompt_tokens,
                        completion_tokens,
                        total_tokens,
                        openrouter_request_id,
                        created_at",
                    &[
                        &id,
                        &input.conversation_id,
                        &input.message_id,
                        &user_id,
                        &organization_id,
                        &input.model_id,
                        &(input.prompt_tokens as i64),
                        &(input.completion_tokens as i64),
                        &(input.total_tokens as i64),
                        &input.openrouter_request_id,
                        &now,
                    ],
                )
                .await
                .map_err(query_error)?;

            let row = rows.into_iter().next().ok_or_else(|| {
                DataAccessError::new(
                    DataAccessErrorKind::Internal,
                    "record usage returned no rows",
                )
            })?;

            Ok(map_usage_row(row))
        })
    }

    fn list_usage(
        &self,
        user_id: &str,
        query: AiUsageQuery,
    ) -> BoxFuture<'_, Result<AiUsagePage, DataAccessError>> {
        let user_id = user_id.to_string();

        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;

            let mut clauses = vec![String::from("user_id = $1")];
            let mut params: Vec<Box<dyn ToSql + Send + Sync>> = vec![Box::new(user_id.clone())];
            let mut param_index = 2;

            if let Some(start_date) = query.start_date.clone() {
                clauses.push(format!("created_at >= ${param_index}"));
                params.push(Box::new(start_date));
                param_index += 1;
            }
            if let Some(end_date) = query.end_date.clone() {
                clauses.push(format!("created_at < ${param_index}"));
                params.push(Box::new(end_date));
                param_index += 1;
            }
            if let Some(cursor) = query.cursor.clone() {
                clauses.push(format!("created_at < ${param_index}"));
                params.push(Box::new(cursor));
                param_index += 1;
            }

            let limit_plus_one = i64::from(query.limit) + 1;
            let limit_index = param_index;
            params.push(Box::new(limit_plus_one));

            let sql = format!(
                "SELECT
                    id,
                    conversation_id,
                    message_id,
                    user_id,
                    organization_id,
                    model_id,
                    prompt_tokens,
                    completion_tokens,
                    total_tokens,
                    openrouter_request_id,
                    created_at
                FROM ai_usage
                WHERE {}
                ORDER BY created_at DESC
                LIMIT ${limit_index}",
                clauses.join(" AND ")
            );

            let param_refs: Vec<&(dyn ToSql + Sync)> = params
                .iter()
                .map(|value| &**value as &(dyn ToSql + Sync))
                .collect();
            let rows = client.query(&sql, &param_refs).await.map_err(query_error)?;

            let mut usage = rows.into_iter().map(map_usage_row).collect::<Vec<_>>();
            let has_more = usage.len() > query.limit as usize;
            if has_more {
                usage.truncate(query.limit as usize);
            }

            let cursor = if has_more {
                usage.last().map(|row| row.created_at.clone())
            } else {
                None
            };

            let summary = fetch_usage_summary(
                &client,
                &user_id,
                query.start_date.clone(),
                query.end_date.clone(),
            )
            .await?;

            Ok(AiUsagePage {
                usage,
                summary,
                has_more,
                cursor,
            })
        })
    }

    fn get_usage_summary(
        &self,
        user_id: &str,
        start_date: Option<String>,
        end_date: Option<String>,
    ) -> BoxFuture<'_, Result<AiUsageSummaryByModel, DataAccessError>> {
        let user_id = user_id.to_string();

        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let summary =
                fetch_usage_summary(&client, &user_id, start_date.clone(), end_date.clone())
                    .await?;
            let by_model =
                fetch_usage_summary_by_model(&client, &user_id, start_date, end_date).await?;
            Ok(AiUsageSummaryByModel { summary, by_model })
        })
    }
}

async fn fetch_usage_summary(
    client: &deadpool_postgres::Client,
    user_id: &str,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<AiUsageSummary, DataAccessError> {
    let mut clauses = vec![String::from("user_id = $1")];
    let mut params: Vec<Box<dyn ToSql + Send + Sync>> = vec![Box::new(user_id.to_string())];
    let mut param_index = 2;

    if let Some(start_date) = start_date {
        clauses.push(format!("created_at >= ${param_index}"));
        params.push(Box::new(start_date));
        param_index += 1;
    }
    if let Some(end_date) = end_date {
        clauses.push(format!("created_at < ${param_index}"));
        params.push(Box::new(end_date));
    }

    let sql = format!(
        "SELECT
            COALESCE(SUM(prompt_tokens), 0) AS total_prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS total_completion_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COUNT(*) AS request_count,
            MIN(created_at) AS period_start,
            MAX(created_at) AS period_end
        FROM ai_usage
        WHERE {}",
        clauses.join(" AND ")
    );

    let param_refs: Vec<&(dyn ToSql + Sync)> = params
        .iter()
        .map(|value| &**value as &(dyn ToSql + Sync))
        .collect();
    let rows = client.query(&sql, &param_refs).await.map_err(query_error)?;
    let row = rows.into_iter().next().ok_or_else(|| {
        DataAccessError::new(
            DataAccessErrorKind::Internal,
            "usage summary query returned no rows",
        )
    })?;

    Ok(map_usage_summary_row(row))
}

async fn fetch_usage_summary_by_model(
    client: &deadpool_postgres::Client,
    user_id: &str,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<BTreeMap<String, AiUsageSummary>, DataAccessError> {
    let mut clauses = vec![String::from("user_id = $1")];
    let mut params: Vec<Box<dyn ToSql + Send + Sync>> = vec![Box::new(user_id.to_string())];
    let mut param_index = 2;

    if let Some(start_date) = start_date {
        clauses.push(format!("created_at >= ${param_index}"));
        params.push(Box::new(start_date));
        param_index += 1;
    }
    if let Some(end_date) = end_date {
        clauses.push(format!("created_at < ${param_index}"));
        params.push(Box::new(end_date));
    }

    let sql = format!(
        "SELECT
            model_id,
            COALESCE(SUM(prompt_tokens), 0) AS total_prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS total_completion_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COUNT(*) AS request_count,
            MIN(created_at) AS period_start,
            MAX(created_at) AS period_end
        FROM ai_usage
        WHERE {}
        GROUP BY model_id",
        clauses.join(" AND ")
    );

    let param_refs: Vec<&(dyn ToSql + Sync)> = params
        .iter()
        .map(|value| &**value as &(dyn ToSql + Sync))
        .collect();
    let rows = client.query(&sql, &param_refs).await.map_err(query_error)?;

    let mut by_model = BTreeMap::new();
    for row in rows {
        let model_id: String = row.get("model_id");
        let summary = map_usage_summary_row(row);
        by_model.insert(model_id, summary);
    }

    Ok(by_model)
}

fn map_usage_row(row: tokio_postgres::Row) -> AiUsageRecord {
    let created_at: DateTime<Utc> = row.get("created_at");
    let prompt_tokens: i32 = row.get("prompt_tokens");
    let completion_tokens: i32 = row.get("completion_tokens");
    let total_tokens: i32 = row.get("total_tokens");

    AiUsageRecord {
        id: row.get("id"),
        conversation_id: row.get("conversation_id"),
        message_id: row.get("message_id"),
        user_id: row.get("user_id"),
        organization_id: row.get("organization_id"),
        model_id: row.get("model_id"),
        prompt_tokens: non_negative_i32_to_u64(prompt_tokens),
        completion_tokens: non_negative_i32_to_u64(completion_tokens),
        total_tokens: non_negative_i32_to_u64(total_tokens),
        openrouter_request_id: row.get("openrouter_request_id"),
        created_at: to_rfc3339(created_at),
    }
}

fn map_usage_summary_row(row: tokio_postgres::Row) -> AiUsageSummary {
    let period_start: Option<DateTime<Utc>> = row.get("period_start");
    let period_end: Option<DateTime<Utc>> = row.get("period_end");
    let now = Utc::now();

    AiUsageSummary {
        total_prompt_tokens: row.get::<_, i64>("total_prompt_tokens").max(0) as u64,
        total_completion_tokens: row.get::<_, i64>("total_completion_tokens").max(0) as u64,
        total_tokens: row.get::<_, i64>("total_tokens").max(0) as u64,
        request_count: row.get::<_, i64>("request_count").max(0) as u64,
        period_start: period_start.unwrap_or(now).to_rfc3339(),
        period_end: period_end.unwrap_or(now).to_rfc3339(),
    }
}

use std::collections::BTreeMap;

use chrono::Utc;
use tearleads_data_access_traits::{
    AiRecordUsageInput, AiUsagePage, AiUsageQuery, AiUsageRecord, AiUsageSummary,
    AiUsageSummaryByModel, BoxFuture, DataAccessError, PostgresAiUsageRepository,
};

use super::StaticPostgresRepository;

impl PostgresAiUsageRepository for StaticPostgresRepository {
    fn record_usage(
        &self,
        user_id: &str,
        input: AiRecordUsageInput,
    ) -> BoxFuture<'_, Result<AiUsageRecord, DataAccessError>> {
        let user_id = user_id.to_string();

        Box::pin(async move {
            let now = Utc::now().to_rfc3339();
            Ok(AiUsageRecord {
                id: format!("usage-{}", Utc::now().timestamp_micros()),
                conversation_id: input.conversation_id,
                message_id: input.message_id,
                user_id,
                organization_id: Some(String::from("org-1")),
                model_id: input.model_id,
                prompt_tokens: input.prompt_tokens,
                completion_tokens: input.completion_tokens,
                total_tokens: input.total_tokens,
                openrouter_request_id: input.openrouter_request_id,
                created_at: now,
            })
        })
    }

    fn list_usage(
        &self,
        user_id: &str,
        query: AiUsageQuery,
    ) -> BoxFuture<'_, Result<AiUsagePage, DataAccessError>> {
        let user_id = user_id.to_string();

        Box::pin(async move {
            let rows = sample_usage_rows(&user_id);
            let filtered = filter_usage_rows(rows, query.start_date, query.end_date, query.cursor);
            let summary = summarize_usage(&filtered);

            let has_more = filtered.len() > query.limit as usize;
            let mut page_rows = filtered;
            if has_more {
                page_rows.truncate(query.limit as usize);
            }

            let cursor = if has_more {
                page_rows.last().map(|row| row.created_at.clone())
            } else {
                None
            };

            Ok(AiUsagePage {
                usage: page_rows,
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
            let rows = sample_usage_rows(&user_id);
            let filtered = filter_usage_rows(rows, start_date, end_date, None);
            let summary = summarize_usage(&filtered);
            let by_model = summarize_usage_by_model(&filtered);
            Ok(AiUsageSummaryByModel { summary, by_model })
        })
    }
}

fn sample_usage_rows(user_id: &str) -> Vec<AiUsageRecord> {
    vec![
        AiUsageRecord {
            id: String::from("usage-2"),
            conversation_id: Some(String::from("conversation-2")),
            message_id: Some(String::from("message-2")),
            user_id: user_id.to_string(),
            organization_id: Some(String::from("org-1")),
            model_id: String::from("google/gemma-3-4b-it:free"),
            prompt_tokens: 12,
            completion_tokens: 4,
            total_tokens: 16,
            openrouter_request_id: Some(String::from("req-2")),
            created_at: String::from("2026-03-09T12:00:00Z"),
        },
        AiUsageRecord {
            id: String::from("usage-3"),
            conversation_id: Some(String::from("conversation-3")),
            message_id: Some(String::from("message-3")),
            user_id: user_id.to_string(),
            organization_id: Some(String::from("org-1")),
            model_id: String::from("mistralai/mistral-7b-instruct"),
            prompt_tokens: 3,
            completion_tokens: 2,
            total_tokens: 5,
            openrouter_request_id: Some(String::from("req-3")),
            created_at: String::from("2026-03-08T12:00:00Z"),
        },
        AiUsageRecord {
            id: String::from("usage-1"),
            conversation_id: Some(String::from("conversation-1")),
            message_id: Some(String::from("message-1")),
            user_id: user_id.to_string(),
            organization_id: Some(String::from("org-1")),
            model_id: String::from("mistralai/mistral-7b-instruct"),
            prompt_tokens: 20,
            completion_tokens: 5,
            total_tokens: 25,
            openrouter_request_id: Some(String::from("req-1")),
            created_at: String::from("2026-03-10T12:00:00Z"),
        },
    ]
}

fn filter_usage_rows(
    rows: Vec<AiUsageRecord>,
    start_date: Option<String>,
    end_date: Option<String>,
    cursor: Option<String>,
) -> Vec<AiUsageRecord> {
    rows.into_iter()
        .filter(|row| {
            if let Some(start) = start_date.as_deref()
                && row.created_at.as_str() < start
            {
                return false;
            }
            if let Some(end) = end_date.as_deref()
                && row.created_at.as_str() >= end
            {
                return false;
            }
            if let Some(cursor) = cursor.as_deref()
                && row.created_at.as_str() >= cursor
            {
                return false;
            }
            true
        })
        .collect()
}

fn summarize_usage(rows: &[AiUsageRecord]) -> AiUsageSummary {
    if rows.is_empty() {
        let now = Utc::now().to_rfc3339();
        return AiUsageSummary {
            total_prompt_tokens: 0,
            total_completion_tokens: 0,
            total_tokens: 0,
            request_count: 0,
            period_start: now.clone(),
            period_end: now,
        };
    }

    let mut total_prompt_tokens = 0u64;
    let mut total_completion_tokens = 0u64;
    let mut total_tokens = 0u64;
    let mut period_start = rows[0].created_at.clone();
    let mut period_end = rows[0].created_at.clone();

    for row in rows {
        total_prompt_tokens += row.prompt_tokens;
        total_completion_tokens += row.completion_tokens;
        total_tokens += row.total_tokens;
        if row.created_at < period_start {
            period_start = row.created_at.clone();
        }
        if row.created_at > period_end {
            period_end = row.created_at.clone();
        }
    }

    AiUsageSummary {
        total_prompt_tokens,
        total_completion_tokens,
        total_tokens,
        request_count: rows.len() as u64,
        period_start,
        period_end,
    }
}

fn summarize_usage_by_model(rows: &[AiUsageRecord]) -> BTreeMap<String, AiUsageSummary> {
    let mut grouped: BTreeMap<String, Vec<AiUsageRecord>> = BTreeMap::new();
    for row in rows {
        grouped
            .entry(row.model_id.clone())
            .or_default()
            .push(row.clone());
    }

    grouped
        .into_iter()
        .map(|(model_id, model_rows)| (model_id, summarize_usage(&model_rows)))
        .collect()
}

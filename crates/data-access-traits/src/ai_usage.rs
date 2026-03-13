//! Postgres read/write models and repository boundary for AI usage RPCs.

use std::collections::BTreeMap;

use crate::{BoxFuture, DataAccessError};

/// Persisted usage row returned by AI usage APIs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiUsageRecord {
    /// Usage row identifier.
    pub id: String,
    /// Optional conversation identifier.
    pub conversation_id: Option<String>,
    /// Optional message identifier.
    pub message_id: Option<String>,
    /// User identifier.
    pub user_id: String,
    /// Optional organization identifier.
    pub organization_id: Option<String>,
    /// Model identifier.
    pub model_id: String,
    /// Prompt tokens.
    pub prompt_tokens: u64,
    /// Completion tokens.
    pub completion_tokens: u64,
    /// Total tokens.
    pub total_tokens: u64,
    /// Optional OpenRouter request identifier.
    pub openrouter_request_id: Option<String>,
    /// RFC3339 creation timestamp.
    pub created_at: String,
}

/// Usage summary payload for one query scope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiUsageSummary {
    /// Total prompt tokens.
    pub total_prompt_tokens: u64,
    /// Total completion tokens.
    pub total_completion_tokens: u64,
    /// Total tokens.
    pub total_tokens: u64,
    /// Request count.
    pub request_count: u64,
    /// RFC3339 period start timestamp.
    pub period_start: String,
    /// RFC3339 period end timestamp.
    pub period_end: String,
}

/// Input payload for recording usage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiRecordUsageInput {
    /// Optional conversation identifier.
    pub conversation_id: Option<String>,
    /// Optional message identifier.
    pub message_id: Option<String>,
    /// Model identifier.
    pub model_id: String,
    /// Prompt tokens.
    pub prompt_tokens: u64,
    /// Completion tokens.
    pub completion_tokens: u64,
    /// Total tokens.
    pub total_tokens: u64,
    /// Optional OpenRouter request identifier.
    pub openrouter_request_id: Option<String>,
}

/// Query options for usage listing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiUsageQuery {
    /// Optional RFC3339 lower bound (inclusive).
    pub start_date: Option<String>,
    /// Optional RFC3339 upper bound (exclusive).
    pub end_date: Option<String>,
    /// Optional RFC3339 cursor (`created_at < cursor`).
    pub cursor: Option<String>,
    /// Effective page size.
    pub limit: u32,
}

/// Usage page payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiUsagePage {
    /// Usage rows.
    pub usage: Vec<AiUsageRecord>,
    /// Aggregate summary for the same scope.
    pub summary: AiUsageSummary,
    /// Whether more rows are available.
    pub has_more: bool,
    /// Optional pagination cursor.
    pub cursor: Option<String>,
}

/// Usage summary payload including per-model rollups.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiUsageSummaryByModel {
    /// Aggregate summary.
    pub summary: AiUsageSummary,
    /// Per-model aggregate summaries.
    pub by_model: BTreeMap<String, AiUsageSummary>,
}

/// Repository boundary for AI usage reads/writes.
pub trait PostgresAiUsageRepository: Send + Sync {
    /// Records one usage row for a user.
    fn record_usage(
        &self,
        user_id: &str,
        input: AiRecordUsageInput,
    ) -> BoxFuture<'_, Result<AiUsageRecord, DataAccessError>>;

    /// Returns one page of usage rows plus aggregate summary.
    fn list_usage(
        &self,
        user_id: &str,
        query: AiUsageQuery,
    ) -> BoxFuture<'_, Result<AiUsagePage, DataAccessError>>;

    /// Returns aggregate usage summary and per-model summary maps.
    fn get_usage_summary(
        &self,
        user_id: &str,
        start_date: Option<String>,
        end_date: Option<String>,
    ) -> BoxFuture<'_, Result<AiUsageSummaryByModel, DataAccessError>>;
}

//! Contract-first AI usage RPC handlers backed by repository traits.

use std::collections::HashMap;

use tearleads_api_v2_contracts::tearleads::v2::{
    AiServiceGetUsageRequest, AiServiceGetUsageResponse, AiServiceGetUsageSummaryRequest,
    AiServiceGetUsageSummaryResponse, AiServiceRecordUsageRequest, AiServiceRecordUsageResponse,
    AiUsage, AiUsageSummary, ai_service_server::AiService,
};
use tearleads_data_access_traits::{
    AiRecordUsageInput, AiUsageQuery, AiUsageRecord as RepoAiUsageRecord,
    AiUsageSummary as RepoAiUsageSummary, PostgresAiUsageRepository,
};
use tonic::{Request, Response, Status};

use crate::admin_service_common::map_data_access_error;
use crate::billing_auth::{
    BillingRequestAuthorizer, JwtSessionBillingAuthorizer, map_billing_auth_error,
};

const DEFAULT_USAGE_LIMIT: u32 = 50;
const MAX_USAGE_LIMIT: u32 = 100;

/// Trait-backed implementation of `tearleads.v2.AiService`.
pub struct AiServiceHandler<P, A = JwtSessionBillingAuthorizer> {
    usage_repo: P,
    authorizer: A,
}

impl<P, A> AiServiceHandler<P, A> {
    /// Creates an AI service handler from repository and auth policy implementations.
    pub fn with_authorizer(usage_repo: P, authorizer: A) -> Self {
        Self {
            usage_repo,
            authorizer,
        }
    }
}

impl<P> AiServiceHandler<P, JwtSessionBillingAuthorizer> {
    /// Creates an AI service handler using runtime JWT/session auth policy.
    pub fn new(usage_repo: P) -> Self {
        Self::with_authorizer(usage_repo, JwtSessionBillingAuthorizer::from_env())
    }
}

#[tonic::async_trait]
impl<P, A> AiService for AiServiceHandler<P, A>
where
    P: PostgresAiUsageRepository + Send + Sync + 'static,
    A: BillingRequestAuthorizer + Send + Sync + 'static,
{
    async fn record_usage(
        &self,
        request: Request<AiServiceRecordUsageRequest>,
    ) -> Result<Response<AiServiceRecordUsageResponse>, Status> {
        let access = self
            .authorizer
            .authorize_billing_request(request.metadata())
            .await
            .map_err(map_billing_auth_error)?;
        let payload = request.into_inner();

        let model_id = normalize_required_string("modelId", &payload.model_id)?;
        let (prompt_tokens, completion_tokens, total_tokens) = validate_token_counts(
            payload.prompt_tokens,
            payload.completion_tokens,
            payload.total_tokens,
        )?;

        let saved = self
            .usage_repo
            .record_usage(
                access.user_id(),
                AiRecordUsageInput {
                    conversation_id: normalize_optional_string(&payload.conversation_id),
                    message_id: normalize_optional_string(&payload.message_id),
                    model_id,
                    prompt_tokens,
                    completion_tokens,
                    total_tokens,
                    openrouter_request_id: normalize_optional_string(
                        &payload.openrouter_request_id,
                    ),
                },
            )
            .await
            .map_err(map_data_access_error)?;

        Ok(Response::new(AiServiceRecordUsageResponse {
            usage: Some(map_usage_record(saved)),
        }))
    }

    async fn get_usage(
        &self,
        request: Request<AiServiceGetUsageRequest>,
    ) -> Result<Response<AiServiceGetUsageResponse>, Status> {
        let access = self
            .authorizer
            .authorize_billing_request(request.metadata())
            .await
            .map_err(map_billing_auth_error)?;
        let payload = request.into_inner();

        let page = self
            .usage_repo
            .list_usage(
                access.user_id(),
                AiUsageQuery {
                    start_date: normalize_optional_string(&payload.start_date),
                    end_date: normalize_optional_string(&payload.end_date),
                    cursor: normalize_optional_string(&payload.cursor),
                    limit: normalize_usage_limit(payload.limit),
                },
            )
            .await
            .map_err(map_data_access_error)?;

        Ok(Response::new(AiServiceGetUsageResponse {
            usage: page.usage.into_iter().map(map_usage_record).collect(),
            summary: Some(map_usage_summary(page.summary)),
            has_more: page.has_more,
            cursor: page.cursor,
        }))
    }

    async fn get_usage_summary(
        &self,
        request: Request<AiServiceGetUsageSummaryRequest>,
    ) -> Result<Response<AiServiceGetUsageSummaryResponse>, Status> {
        let access = self
            .authorizer
            .authorize_billing_request(request.metadata())
            .await
            .map_err(map_billing_auth_error)?;
        let payload = request.into_inner();

        let summary = self
            .usage_repo
            .get_usage_summary(
                access.user_id(),
                normalize_optional_string(&payload.start_date),
                normalize_optional_string(&payload.end_date),
            )
            .await
            .map_err(map_data_access_error)?;

        let by_model = summary
            .by_model
            .into_iter()
            .map(|(model_id, value)| (model_id, map_usage_summary(value)))
            .collect::<HashMap<_, _>>();

        Ok(Response::new(AiServiceGetUsageSummaryResponse {
            summary: Some(map_usage_summary(summary.summary)),
            by_model,
        }))
    }
}

fn normalize_usage_limit(limit: i32) -> u32 {
    if limit <= 0 {
        return DEFAULT_USAGE_LIMIT;
    }
    let clamped = limit as u32;
    clamped.clamp(1, MAX_USAGE_LIMIT)
}

fn normalize_optional_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_required_string(field: &'static str, value: &str) -> Result<String, Status> {
    normalize_optional_string(value)
        .ok_or_else(|| Status::invalid_argument(format!("{field} is required")))
}

fn validate_token_counts(
    prompt_tokens: i32,
    completion_tokens: i32,
    total_tokens: i32,
) -> Result<(u64, u64, u64), Status> {
    if prompt_tokens < 0 || completion_tokens < 0 || total_tokens < 0 {
        return Err(Status::invalid_argument(
            "modelId is required and token counts must be non-negative integers with totalTokens matching promptTokens + completionTokens",
        ));
    }

    if prompt_tokens + completion_tokens != total_tokens {
        return Err(Status::invalid_argument(
            "modelId is required and token counts must be non-negative integers with totalTokens matching promptTokens + completionTokens",
        ));
    }

    Ok((
        prompt_tokens as u64,
        completion_tokens as u64,
        total_tokens as u64,
    ))
}

fn saturating_i32(value: u64) -> i32 {
    value.min(i32::MAX as u64) as i32
}

fn map_usage_record(record: RepoAiUsageRecord) -> AiUsage {
    AiUsage {
        id: record.id,
        conversation_id: record.conversation_id,
        message_id: record.message_id,
        user_id: record.user_id,
        organization_id: record.organization_id,
        model_id: record.model_id,
        prompt_tokens: saturating_i32(record.prompt_tokens),
        completion_tokens: saturating_i32(record.completion_tokens),
        total_tokens: saturating_i32(record.total_tokens),
        openrouter_request_id: record.openrouter_request_id,
        created_at: record.created_at,
    }
}

fn map_usage_summary(summary: RepoAiUsageSummary) -> AiUsageSummary {
    AiUsageSummary {
        total_prompt_tokens: saturating_i32(summary.total_prompt_tokens),
        total_completion_tokens: saturating_i32(summary.total_completion_tokens),
        total_tokens: saturating_i32(summary.total_tokens),
        request_count: saturating_i32(summary.request_count),
        period_start: summary.period_start,
        period_end: summary.period_end,
    }
}

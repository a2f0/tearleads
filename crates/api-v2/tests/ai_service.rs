//! Integration tests for the v2 AI usage service handler core.

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, MutexGuard},
};

use tearleads_api_v2::{
    AiServiceHandler, BillingAccessContext, BillingAuthError, BillingAuthErrorKind,
    BillingRequestAuthorizer,
};
use tearleads_api_v2_contracts::tearleads::v2::{
    AiServiceGetUsageRequest, AiServiceGetUsageSummaryRequest, AiServiceRecordUsageRequest,
    ai_service_server::AiService,
};
use tearleads_data_access_traits::{
    AiRecordUsageInput, AiUsagePage, AiUsageQuery, AiUsageRecord, AiUsageSummary,
    AiUsageSummaryByModel, BoxFuture, DataAccessError, DataAccessErrorKind,
    PostgresAiUsageRepository,
};
use tonic::{Code, Request};

#[derive(Debug, Clone)]
struct FakeAuthorizer {
    outcome: Result<BillingAccessContext, BillingAuthError>,
}

impl FakeAuthorizer {
    fn allow(user_id: &str) -> Self {
        Self {
            outcome: Ok(BillingAccessContext::new(user_id)),
        }
    }

    fn deny(kind: BillingAuthErrorKind, message: &str) -> Self {
        Self {
            outcome: Err(BillingAuthError::new(kind, message)),
        }
    }
}

impl BillingRequestAuthorizer for FakeAuthorizer {
    fn authorize_billing_request(
        &self,
        _metadata: &tonic::metadata::MetadataMap,
    ) -> BoxFuture<'_, Result<BillingAccessContext, BillingAuthError>> {
        let result = self.outcome.clone();
        Box::pin(async move { result })
    }
}

type RecordUsageCalls = Arc<Mutex<Vec<(String, AiRecordUsageInput)>>>;
type ListUsageCalls = Arc<Mutex<Vec<(String, AiUsageQuery)>>>;
type GetUsageSummaryCalls = Arc<Mutex<Vec<(String, Option<String>, Option<String>)>>>;

#[derive(Debug, Clone)]
struct FakeAiUsageRepository {
    record_result: Result<AiUsageRecord, DataAccessError>,
    record_calls: RecordUsageCalls,
    list_result: Result<AiUsagePage, DataAccessError>,
    list_calls: ListUsageCalls,
    summary_result: Result<AiUsageSummaryByModel, DataAccessError>,
    summary_calls: GetUsageSummaryCalls,
}

impl Default for FakeAiUsageRepository {
    fn default() -> Self {
        Self {
            record_result: Ok(AiUsageRecord {
                id: String::from("usage-1"),
                conversation_id: Some(String::from("conversation-1")),
                message_id: Some(String::from("message-1")),
                user_id: String::from("user-1"),
                organization_id: Some(String::from("org-1")),
                model_id: String::from("mistralai/mistral-7b-instruct"),
                prompt_tokens: 12,
                completion_tokens: 5,
                total_tokens: 17,
                openrouter_request_id: Some(String::from("req-1")),
                created_at: String::from("2026-03-11T12:00:00Z"),
            }),
            record_calls: Arc::new(Mutex::new(Vec::new())),
            list_result: Ok(AiUsagePage {
                usage: vec![AiUsageRecord {
                    id: String::from("usage-2"),
                    conversation_id: None,
                    message_id: None,
                    user_id: String::from("user-1"),
                    organization_id: Some(String::from("org-1")),
                    model_id: String::from("mistralai/mistral-7b-instruct"),
                    prompt_tokens: 2,
                    completion_tokens: 1,
                    total_tokens: 3,
                    openrouter_request_id: None,
                    created_at: String::from("2026-03-10T12:00:00Z"),
                }],
                summary: AiUsageSummary {
                    total_prompt_tokens: 2,
                    total_completion_tokens: 1,
                    total_tokens: 3,
                    request_count: 1,
                    period_start: String::from("2026-03-10T12:00:00Z"),
                    period_end: String::from("2026-03-10T12:00:00Z"),
                },
                has_more: false,
                cursor: None,
            }),
            list_calls: Arc::new(Mutex::new(Vec::new())),
            summary_result: Ok(AiUsageSummaryByModel {
                summary: AiUsageSummary {
                    total_prompt_tokens: 7,
                    total_completion_tokens: 3,
                    total_tokens: 10,
                    request_count: 2,
                    period_start: String::from("2026-03-10T00:00:00Z"),
                    period_end: String::from("2026-03-11T00:00:00Z"),
                },
                by_model: BTreeMap::from([(
                    String::from("mistralai/mistral-7b-instruct"),
                    AiUsageSummary {
                        total_prompt_tokens: 7,
                        total_completion_tokens: 3,
                        total_tokens: 10,
                        request_count: 2,
                        period_start: String::from("2026-03-10T00:00:00Z"),
                        period_end: String::from("2026-03-11T00:00:00Z"),
                    },
                )]),
            }),
            summary_calls: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl PostgresAiUsageRepository for FakeAiUsageRepository {
    fn record_usage(
        &self,
        user_id: &str,
        input: AiRecordUsageInput,
    ) -> BoxFuture<'_, Result<AiUsageRecord, DataAccessError>> {
        lock_or_recover(&self.record_calls).push((user_id.to_string(), input));
        let result = self.record_result.clone();
        Box::pin(async move { result })
    }

    fn list_usage(
        &self,
        user_id: &str,
        query: AiUsageQuery,
    ) -> BoxFuture<'_, Result<AiUsagePage, DataAccessError>> {
        lock_or_recover(&self.list_calls).push((user_id.to_string(), query));
        let result = self.list_result.clone();
        Box::pin(async move { result })
    }

    fn get_usage_summary(
        &self,
        user_id: &str,
        start_date: Option<String>,
        end_date: Option<String>,
    ) -> BoxFuture<'_, Result<AiUsageSummaryByModel, DataAccessError>> {
        lock_or_recover(&self.summary_calls).push((user_id.to_string(), start_date, end_date));
        let result = self.summary_result.clone();
        Box::pin(async move { result })
    }
}

#[tokio::test]
async fn record_usage_rejects_invalid_token_counts() {
    let repository = FakeAiUsageRepository::default();
    let record_calls = Arc::clone(&repository.record_calls);
    let handler = AiServiceHandler::with_authorizer(repository, FakeAuthorizer::allow("user-1"));

    let status = handler
        .record_usage(Request::new(AiServiceRecordUsageRequest {
            conversation_id: String::new(),
            message_id: String::new(),
            model_id: String::from("mistralai/mistral-7b-instruct"),
            prompt_tokens: 5,
            completion_tokens: 2,
            total_tokens: 9,
            openrouter_request_id: String::new(),
        }))
        .await
        .expect_err("mismatched token counts must fail");

    assert_eq!(status.code(), Code::InvalidArgument);
    assert!(lock_or_recover(&record_calls).is_empty());
}

#[tokio::test]
async fn record_usage_maps_repository_result() {
    let repository = FakeAiUsageRepository::default();
    let record_calls = Arc::clone(&repository.record_calls);
    let handler = AiServiceHandler::with_authorizer(repository, FakeAuthorizer::allow("user-1"));

    let payload = handler
        .record_usage(Request::new(AiServiceRecordUsageRequest {
            conversation_id: String::from(" conversation-1 "),
            message_id: String::new(),
            model_id: String::from("mistralai/mistral-7b-instruct"),
            prompt_tokens: 5,
            completion_tokens: 2,
            total_tokens: 7,
            openrouter_request_id: String::from(" req-1 "),
        }))
        .await
        .expect("record usage should succeed")
        .into_inner();

    let calls = lock_or_recover(&record_calls).clone();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, String::from("user-1"));
    assert_eq!(
        calls[0].1.conversation_id.as_deref(),
        Some("conversation-1")
    );
    assert_eq!(calls[0].1.message_id, None);
    assert_eq!(calls[0].1.openrouter_request_id.as_deref(), Some("req-1"));
    assert_eq!(
        payload.usage.as_ref().map(|usage| usage.total_tokens),
        Some(17)
    );
}

#[tokio::test]
async fn get_usage_normalizes_limit_before_repository_call() {
    let repository = FakeAiUsageRepository::default();
    let list_calls = Arc::clone(&repository.list_calls);
    let handler = AiServiceHandler::with_authorizer(repository, FakeAuthorizer::allow("user-1"));

    let payload = handler
        .get_usage(Request::new(AiServiceGetUsageRequest {
            start_date: String::new(),
            end_date: String::new(),
            cursor: String::new(),
            limit: 0,
        }))
        .await
        .expect("usage listing should succeed")
        .into_inner();

    let calls = lock_or_recover(&list_calls).clone();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].1.limit, 50);
    assert_eq!(payload.usage.len(), 1);
    assert_eq!(
        payload.summary.as_ref().map(|summary| summary.total_tokens),
        Some(3)
    );
}

#[tokio::test]
async fn get_usage_summary_maps_by_model_payload() {
    let repository = FakeAiUsageRepository::default();
    let summary_calls = Arc::clone(&repository.summary_calls);
    let handler = AiServiceHandler::with_authorizer(repository, FakeAuthorizer::allow("user-1"));

    let payload = handler
        .get_usage_summary(Request::new(AiServiceGetUsageSummaryRequest {
            start_date: String::from("2026-03-01T00:00:00Z"),
            end_date: String::new(),
        }))
        .await
        .expect("usage summary should succeed")
        .into_inner();

    let calls = lock_or_recover(&summary_calls).clone();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, String::from("user-1"));
    assert_eq!(calls[0].1.as_deref(), Some("2026-03-01T00:00:00Z"));
    assert_eq!(payload.by_model.len(), 1);
    assert!(
        payload
            .by_model
            .contains_key("mistralai/mistral-7b-instruct")
    );
}

#[tokio::test]
async fn unauthorized_requests_short_circuit_before_repository() {
    let repository = FakeAiUsageRepository::default();
    let list_calls = Arc::clone(&repository.list_calls);
    let handler = AiServiceHandler::with_authorizer(
        repository,
        FakeAuthorizer::deny(BillingAuthErrorKind::Unauthenticated, "Unauthorized"),
    );

    let status = handler
        .get_usage(Request::new(AiServiceGetUsageRequest {
            start_date: String::new(),
            end_date: String::new(),
            cursor: String::new(),
            limit: 10,
        }))
        .await
        .expect_err("unauthorized requests must fail");

    assert_eq!(status.code(), Code::Unauthenticated);
    assert!(lock_or_recover(&list_calls).is_empty());
}

#[tokio::test]
async fn repository_errors_map_to_internal_status() {
    let handler = AiServiceHandler::with_authorizer(
        FakeAiUsageRepository {
            list_result: Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "db down",
            )),
            ..Default::default()
        },
        FakeAuthorizer::allow("user-1"),
    );

    let status = handler
        .get_usage(Request::new(AiServiceGetUsageRequest {
            start_date: String::new(),
            end_date: String::new(),
            cursor: String::new(),
            limit: 10,
        }))
        .await
        .expect_err("repository failures must map to internal");

    assert_eq!(status.code(), Code::Internal);
}

fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

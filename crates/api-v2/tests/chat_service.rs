//! Integration tests for the v2 chat service handler core.

use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex, MutexGuard},
};

use serde_json::{Value, json};
use tearleads_api_v2::{
    BillingAccessContext, BillingAuthError, BillingAuthErrorKind, BillingRequestAuthorizer,
    ChatCompletionGateway, ChatServiceHandler, OpenRouterChatCompletionResult,
};
use tearleads_api_v2_contracts::tearleads::v2::{
    ChatServicePostCompletionsRequest, chat_service_server::ChatService,
};
use tonic::{Code, Request};

#[derive(Debug, Clone)]
struct FakeAuthorizer {
    outcome: Result<BillingAccessContext, BillingAuthError>,
}

impl FakeAuthorizer {
    fn allow() -> Self {
        Self {
            outcome: Ok(BillingAccessContext::new("user-1")),
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
    ) -> tearleads_data_access_traits::BoxFuture<'_, Result<BillingAccessContext, BillingAuthError>>
    {
        let result = self.outcome.clone();
        Box::pin(async move { result })
    }
}

#[derive(Debug, Clone)]
struct FakeGateway {
    result: OpenRouterChatCompletionResult,
    calls: Arc<Mutex<Vec<(String, Vec<Value>)>>>,
}

impl ChatCompletionGateway for FakeGateway {
    fn post_chat_completions(
        &self,
        model_id: &str,
        messages: &[Value],
    ) -> Pin<Box<dyn Future<Output = OpenRouterChatCompletionResult> + Send + '_>> {
        lock_or_recover(&self.calls).push((model_id.to_string(), messages.to_vec()));
        let result = self.result.clone();
        Box::pin(async move { result })
    }
}

#[tokio::test]
async fn rejects_unauthenticated_requests() {
    let handler = ChatServiceHandler::with_gateway_and_authorizer(
        FakeGateway {
            result: OpenRouterChatCompletionResult::new(200, json!({})),
            calls: Arc::new(Mutex::new(Vec::new())),
        },
        FakeAuthorizer::deny(BillingAuthErrorKind::Unauthenticated, "Unauthorized"),
    );

    let status = handler
        .post_completions(Request::new(ChatServicePostCompletionsRequest {
            json: String::from("{}"),
        }))
        .await
        .expect_err("unauthenticated request should fail");

    assert_eq!(status.code(), Code::Unauthenticated);
}

#[tokio::test]
async fn rejects_invalid_json_payload() {
    let handler = ChatServiceHandler::with_gateway_and_authorizer(
        FakeGateway {
            result: OpenRouterChatCompletionResult::new(200, json!({})),
            calls: Arc::new(Mutex::new(Vec::new())),
        },
        FakeAuthorizer::allow(),
    );

    let status = handler
        .post_completions(Request::new(ChatServicePostCompletionsRequest {
            json: String::from("{"),
        }))
        .await
        .expect_err("invalid json should fail validation");

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(status.message(), "Invalid JSON payload");
}

#[tokio::test]
async fn rejects_invalid_message_shape() {
    let handler = ChatServiceHandler::with_gateway_and_authorizer(
        FakeGateway {
            result: OpenRouterChatCompletionResult::new(200, json!({})),
            calls: Arc::new(Mutex::new(Vec::new())),
        },
        FakeAuthorizer::allow(),
    );

    let status = handler
        .post_completions(Request::new(ChatServicePostCompletionsRequest {
            json: String::from("{}"),
        }))
        .await
        .expect_err("missing messages should fail validation");

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(status.message(), "messages must be a non-empty array");
}

#[tokio::test]
async fn rejects_unsupported_model_id() {
    let handler = ChatServiceHandler::with_gateway_and_authorizer(
        FakeGateway {
            result: OpenRouterChatCompletionResult::new(200, json!({})),
            calls: Arc::new(Mutex::new(Vec::new())),
        },
        FakeAuthorizer::allow(),
    );

    let status = handler
        .post_completions(Request::new(ChatServicePostCompletionsRequest {
            json: String::from(
                "{\"model\":\"unknown/model\",\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}",
            ),
        }))
        .await
        .expect_err("unsupported model should fail validation");

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(
        status.message(),
        "model must be a supported OpenRouter chat model"
    );
}

#[tokio::test]
async fn maps_upstream_http_errors_to_connect_codes() {
    let handler = ChatServiceHandler::with_gateway_and_authorizer(
        FakeGateway {
            result: OpenRouterChatCompletionResult::new(
                401,
                json!({ "error": "OpenRouter denied authentication" }),
            ),
            calls: Arc::new(Mutex::new(Vec::new())),
        },
        FakeAuthorizer::allow(),
    );

    let status = handler
        .post_completions(Request::new(ChatServicePostCompletionsRequest {
            json: String::from("{\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}"),
        }))
        .await
        .expect_err("upstream auth failures should map to unauthenticated");

    assert_eq!(status.code(), Code::Unauthenticated);
    assert_eq!(status.message(), "OpenRouter denied authentication");
}

#[tokio::test]
async fn success_path_uses_default_model_and_returns_json_payload() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let handler = ChatServiceHandler::with_gateway_and_authorizer(
        FakeGateway {
            result: OpenRouterChatCompletionResult::new(
                200,
                json!({ "id": "resp_1", "choices": [] }),
            ),
            calls: Arc::clone(&calls),
        },
        FakeAuthorizer::allow(),
    );

    let response = handler
        .post_completions(Request::new(ChatServicePostCompletionsRequest {
            json: String::from("{\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}"),
        }))
        .await
        .expect("chat completion should succeed")
        .into_inner();

    assert_eq!(
        response.json,
        String::from("{\"choices\":[],\"id\":\"resp_1\"}")
    );

    let recorded_calls = lock_or_recover(&calls).clone();
    assert_eq!(recorded_calls.len(), 1);
    assert_eq!(recorded_calls[0].0, "mistralai/mistral-7b-instruct");
    assert_eq!(recorded_calls[0].1.len(), 1);
}

fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

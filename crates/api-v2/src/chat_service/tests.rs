#![allow(clippy::expect_used)]

use std::{future::Future, pin::Pin};

use serde_json::{Value, json};
use tearleads_api_v2_contracts::tearleads::v2::chat_service_server::ChatService;
use tearleads_data_access_traits::BoxFuture;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tonic::{Code, Request};

use crate::{BillingAccessContext, BillingAuthError, BillingAuthErrorKind};

use super::{
    BillingRequestAuthorizer, ChatCompletionGateway, ChatServiceHandler,
    OpenRouterChatCompletionResult, ReqwestOpenRouterGateway, connect_code_from_http_status,
    error_message_from_payload, normalize_env_value, parse_chat_completions_body,
    parse_json_request_body, parse_openrouter_response_payload, to_json_response_payload,
    validate_chat_messages,
};

#[derive(Clone)]
struct AllowAuthorizer;

impl BillingRequestAuthorizer for AllowAuthorizer {
    fn authorize_billing_request(
        &self,
        _metadata: &tonic::metadata::MetadataMap,
    ) -> BoxFuture<'_, Result<BillingAccessContext, BillingAuthError>> {
        Box::pin(async { Ok(BillingAccessContext::new("user-1")) })
    }
}

#[derive(Clone)]
struct StaticGateway {
    result: OpenRouterChatCompletionResult,
}

impl ChatCompletionGateway for StaticGateway {
    fn post_chat_completions(&self, _model_id: &str, _messages: &[Value]) -> GatewayFuture<'_> {
        let result = self.result.clone();
        Box::pin(async move { result })
    }
}

type GatewayFuture<'a> = Pin<Box<dyn Future<Output = OpenRouterChatCompletionResult> + Send + 'a>>;

#[tokio::test]
async fn reqwest_gateway_returns_500_when_api_key_missing() {
    let gateway = ReqwestOpenRouterGateway {
        http_client: reqwest::Client::new(),
        api_url: "http://127.0.0.1:1".to_string(),
        api_key: None,
    };

    let result = gateway
        .post_chat_completions(
            "mistralai/mistral-7b-instruct",
            &[json!({"role":"user","content":"hello"})],
        )
        .await;

    assert_eq!(result.status, 500);
    assert_eq!(
        result.payload.get("error").and_then(Value::as_str),
        Some("OPENROUTER_API_KEY is not configured on the server")
    );
}

#[tokio::test]
async fn reqwest_gateway_returns_502_when_send_fails() {
    let gateway = ReqwestOpenRouterGateway {
        http_client: reqwest::Client::new(),
        api_url: "http://127.0.0.1:1".to_string(),
        api_key: Some("key".to_string()),
    };

    let result = gateway
        .post_chat_completions(
            "mistralai/mistral-7b-instruct",
            &[json!({"role":"user","content":"hello"})],
        )
        .await;

    assert_eq!(result.status, 502);
    assert_eq!(
        result.payload.get("error").and_then(Value::as_str),
        Some("Failed to contact OpenRouter")
    );
}

#[tokio::test]
async fn reqwest_gateway_returns_502_when_response_body_read_fails() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind should succeed");
    let address = listener.local_addr().expect("local addr should resolve");

    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept should succeed");
        let mut request_buffer = [0_u8; 1024];
        let _ = socket.read(&mut request_buffer).await;
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nabc")
            .await
            .expect("write should succeed");
    });

    let gateway = ReqwestOpenRouterGateway {
        http_client: reqwest::Client::new(),
        api_url: format!("http://{address}"),
        api_key: Some("key".to_string()),
    };

    let result = gateway
        .post_chat_completions(
            "mistralai/mistral-7b-instruct",
            &[json!({"role":"user","content":"hello"})],
        )
        .await;

    server.await.expect("server should join");
    assert_eq!(result.status, 502);
    assert_eq!(
        result.payload.get("error").and_then(Value::as_str),
        Some("Failed to contact OpenRouter")
    );
}

#[tokio::test]
async fn reqwest_gateway_maps_successful_http_response_payload() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind should succeed");
    let address = listener.local_addr().expect("local addr should resolve");
    let app = axum::Router::new().route(
        "/",
        axum::routing::post(|| async { axum::Json(json!({"id":"resp_1","choices":[]})) }),
    );
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("axum server should run");
    });

    let gateway = ReqwestOpenRouterGateway {
        http_client: reqwest::Client::new(),
        api_url: format!("http://{address}/"),
        api_key: Some("key".to_string()),
    };

    let result = gateway
        .post_chat_completions(
            "mistralai/mistral-7b-instruct",
            &[json!({"role":"user","content":"hello"})],
        )
        .await;

    server.abort();
    assert_eq!(result.status, 200);
    assert_eq!(result.payload, json!({"id":"resp_1","choices":[]}));
}

#[test]
fn parse_json_body_covers_empty_invalid_and_valid_paths() {
    let empty = parse_json_request_body("").expect("empty json should default to object");
    assert_eq!(empty, json!({}));

    let status = parse_json_request_body("{").expect_err("invalid json should fail");
    assert_eq!(status.code(), Code::InvalidArgument);

    let parsed = parse_json_request_body("{\"messages\":[]}").expect("valid json should parse");
    assert_eq!(
        parsed
            .get("messages")
            .and_then(Value::as_array)
            .map(Vec::len),
        Some(0)
    );
}

#[test]
fn normalize_env_value_trims_and_filters_empty_values() {
    assert_eq!(
        normalize_env_value(Ok("  key  ".to_string())),
        Some("key".to_string())
    );
    assert_eq!(normalize_env_value(Ok("   ".to_string())), None);
    assert_eq!(
        normalize_env_value(Err(std::env::VarError::NotPresent)),
        None
    );
}

#[test]
fn parse_chat_payload_covers_model_validation_paths() {
    let non_object =
        parse_chat_completions_body(&json!([])).expect_err("non-object payload should fail");
    assert_eq!(non_object.code(), Code::InvalidArgument);

    let valid = parse_chat_completions_body(&json!({
        "messages": [{"role": "user", "content": "hello"}]
    }))
    .expect("valid payload should parse");
    assert_eq!(valid.model_id, "mistralai/mistral-7b-instruct");

    let custom = parse_chat_completions_body(&json!({
        "model": "google/gemma-3-4b-it:free",
        "messages": [{"role": "user", "content": "hello"}]
    }))
    .expect("supported model should parse");
    assert_eq!(custom.model_id, "google/gemma-3-4b-it:free");

    let wrong_model_type = parse_chat_completions_body(&json!({
        "model": 123,
        "messages": [{"role": "user", "content": "hello"}]
    }))
    .expect_err("non-string model should fail");
    assert_eq!(wrong_model_type.code(), Code::InvalidArgument);

    let unsupported_model = parse_chat_completions_body(&json!({
        "model": "not-supported",
        "messages": [{"role": "user", "content": "hello"}]
    }))
    .expect_err("unsupported model should fail");
    assert_eq!(unsupported_model.code(), Code::InvalidArgument);

    let missing_messages =
        parse_chat_completions_body(&json!({"model": "google/gemma-3-4b-it:free"}))
            .expect_err("missing messages should fail");
    assert_eq!(missing_messages.code(), Code::InvalidArgument);
}

#[test]
fn validate_messages_and_content_cover_error_and_success_paths() {
    let not_array = validate_chat_messages(&json!({})).expect_err("non-array should fail");
    assert_eq!(not_array.code(), Code::InvalidArgument);

    let empty = validate_chat_messages(&json!([])).expect_err("empty array should fail");
    assert_eq!(empty.code(), Code::InvalidArgument);

    let not_object =
        validate_chat_messages(&json!(["hello"])).expect_err("non-object message should fail");
    assert_eq!(not_object.code(), Code::InvalidArgument);

    let missing_role = validate_chat_messages(&json!([{"content": "hello"}]))
        .expect_err("missing role should fail");
    assert_eq!(missing_role.code(), Code::InvalidArgument);

    let invalid_role = validate_chat_messages(&json!([{"role": "invalid", "content": "hello"}]))
        .expect_err("invalid role should fail");
    assert_eq!(invalid_role.code(), Code::InvalidArgument);

    let missing_content = validate_chat_messages(&json!([{"role": "user"}]))
        .expect_err("missing content should fail");
    assert_eq!(missing_content.code(), Code::InvalidArgument);

    let empty_text = validate_chat_messages(&json!([{"role": "user", "content": "   "}]))
        .expect_err("empty text should fail");
    assert_eq!(empty_text.code(), Code::InvalidArgument);

    let non_array_content = validate_chat_messages(&json!([{"role": "user", "content": 12}]))
        .expect_err("non-string/non-array content should fail");
    assert_eq!(non_array_content.code(), Code::InvalidArgument);

    let empty_parts = validate_chat_messages(&json!([{"role": "user", "content": []}]))
        .expect_err("empty content part array should fail");
    assert_eq!(empty_parts.code(), Code::InvalidArgument);

    let valid_text = validate_chat_messages(&json!([
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "world"}
    ]))
    .expect("valid text messages should pass");
    assert_eq!(valid_text.len(), 2);

    let valid_multimodal = validate_chat_messages(&json!([{
        "role": "user",
        "content": [
            {"type": "text", "text": "describe this image"},
            {"type": "image_url", "image_url": {"url": "https://example.com/image.png"}}
        ]
    }]))
    .expect("valid multimodal messages should pass");
    assert_eq!(valid_multimodal.len(), 1);
}

#[test]
fn validate_content_part_error_shapes_are_rejected() {
    let part_not_object = validate_chat_messages(&json!([{
        "role": "user",
        "content": ["not-an-object"]
    }]))
    .expect_err("non-object part should fail");
    assert_eq!(part_not_object.code(), Code::InvalidArgument);

    let missing_type = validate_chat_messages(&json!([{
        "role": "user",
        "content": [{}]
    }]))
    .expect_err("missing type should fail");
    assert_eq!(missing_type.code(), Code::InvalidArgument);

    let text_missing_value = validate_chat_messages(&json!([{
        "role": "user",
        "content": [{"type": "text"}]
    }]))
    .expect_err("missing text field should fail");
    assert_eq!(text_missing_value.code(), Code::InvalidArgument);

    let text_empty_value = validate_chat_messages(&json!([{
        "role": "user",
        "content": [{"type": "text", "text": "   "}]
    }]))
    .expect_err("empty text part should fail");
    assert_eq!(text_empty_value.code(), Code::InvalidArgument);

    let image_missing_object = validate_chat_messages(&json!([{
        "role": "user",
        "content": [{"type": "image_url"}]
    }]))
    .expect_err("missing image_url object should fail");
    assert_eq!(image_missing_object.code(), Code::InvalidArgument);

    let image_missing_url = validate_chat_messages(&json!([{
        "role": "user",
        "content": [{"type": "image_url", "image_url": {}}]
    }]))
    .expect_err("missing image url should fail");
    assert_eq!(image_missing_url.code(), Code::InvalidArgument);

    let image_empty_url = validate_chat_messages(&json!([{
        "role": "user",
        "content": [{"type": "image_url", "image_url": {"url": "   "}}]
    }]))
    .expect_err("empty image url should fail");
    assert_eq!(image_empty_url.code(), Code::InvalidArgument);

    let unsupported_type = validate_chat_messages(&json!([{
        "role": "user",
        "content": [{"type": "audio"}]
    }]))
    .expect_err("unsupported part type should fail");
    assert_eq!(unsupported_type.code(), Code::InvalidArgument);
}

#[test]
fn helper_payload_and_error_mapping_cover_branches() {
    assert_eq!(parse_openrouter_response_payload(""), json!({}));
    assert_eq!(
        parse_openrouter_response_payload("{\"id\":\"resp\"}"),
        json!({"id":"resp"})
    );
    assert_eq!(
        parse_openrouter_response_payload("not-json"),
        json!({"error":"not-json"})
    );

    assert_eq!(
        error_message_from_payload(&json!({"error": "detailed"}), "fallback".to_string()),
        "detailed"
    );
    assert_eq!(
        error_message_from_payload(&json!({"error": "   "}), "fallback".to_string()),
        "fallback"
    );
    assert_eq!(
        error_message_from_payload(&json!({}), "fallback".to_string()),
        "fallback"
    );

    assert_eq!(to_json_response_payload(&json!({"a": 1})), "{\"a\":1}");
}

#[test]
fn connect_code_mapping_covers_all_match_arms() {
    assert_eq!(connect_code_from_http_status(400), Code::InvalidArgument);
    assert_eq!(connect_code_from_http_status(401), Code::Unauthenticated);
    assert_eq!(connect_code_from_http_status(403), Code::PermissionDenied);
    assert_eq!(connect_code_from_http_status(404), Code::NotFound);
    assert_eq!(connect_code_from_http_status(409), Code::AlreadyExists);
    assert_eq!(connect_code_from_http_status(412), Code::FailedPrecondition);
    assert_eq!(connect_code_from_http_status(429), Code::ResourceExhausted);
    assert_eq!(connect_code_from_http_status(501), Code::Unimplemented);
    assert_eq!(connect_code_from_http_status(503), Code::Unavailable);
    assert_eq!(connect_code_from_http_status(504), Code::DeadlineExceeded);
    assert_eq!(connect_code_from_http_status(500), Code::Internal);
    assert_eq!(connect_code_from_http_status(502), Code::Internal);
    assert_eq!(connect_code_from_http_status(299), Code::Unknown);
}

#[tokio::test]
async fn handler_maps_upstream_error_fallback_message() {
    let handler = ChatServiceHandler::with_gateway_and_authorizer(
        StaticGateway {
            result: OpenRouterChatCompletionResult::new(503, json!({})),
        },
        AllowAuthorizer,
    );

    let status = handler
        .post_completions(Request::new(
            tearleads_api_v2_contracts::tearleads::v2::ChatServicePostCompletionsRequest {
                json: "{\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}".to_string(),
            },
        ))
        .await
        .expect_err("upstream errors should map to status");

    assert_eq!(status.code(), Code::Unavailable);
    assert_eq!(status.message(), "Chat completion failed with status 503");
}

#[test]
fn constructors_are_available() {
    let _ = ChatServiceHandler::new();
    let _ = ChatServiceHandler::default();
}

#[test]
fn denied_authorizer_shape_is_constructible_for_internal_paths() {
    let error = BillingAuthError::new(BillingAuthErrorKind::Internal, "internal");
    assert_eq!(
        error,
        BillingAuthError::new(BillingAuthErrorKind::Internal, "internal")
    );
}

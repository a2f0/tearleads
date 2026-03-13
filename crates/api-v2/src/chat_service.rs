//! Contract-first chat RPC handler backed by OpenRouter.

use std::{env, future::Future, pin::Pin};

use serde_json::{Map, Value, json};
use tearleads_api_v2_contracts::tearleads::v2::{
    ChatServicePostCompletionsRequest, ChatServicePostCompletionsResponse,
    chat_service_server::ChatService,
};
use tonic::{Code, Request, Response, Status};

use crate::billing_auth::{
    BillingRequestAuthorizer, JwtSessionBillingAuthorizer, map_billing_auth_error,
};

const OPENROUTER_API_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_MODEL_ID: &str = "mistralai/mistral-7b-instruct";
const SUPPORTED_OPENROUTER_MODEL_IDS: [&str; 2] =
    [DEFAULT_OPENROUTER_MODEL_ID, "google/gemma-3-4b-it:free"];

/// Response shape returned by the OpenRouter gateway.
#[derive(Debug, Clone)]
pub struct OpenRouterChatCompletionResult {
    status: u16,
    payload: Value,
}

impl OpenRouterChatCompletionResult {
    /// Creates a result payload from upstream HTTP status and decoded body.
    pub fn new(status: u16, payload: Value) -> Self {
        Self { status, payload }
    }
}

pub type ChatGatewayFuture<'a> =
    Pin<Box<dyn Future<Output = OpenRouterChatCompletionResult> + Send + 'a>>;

/// Gateway boundary for OpenRouter chat completion execution.
pub trait ChatCompletionGateway: Send + Sync {
    /// Posts one chat completion request.
    fn post_chat_completions(&self, model_id: &str, messages: &[Value]) -> ChatGatewayFuture<'_>;
}

/// Reqwest-backed OpenRouter gateway implementation.
#[derive(Clone)]
pub struct ReqwestOpenRouterGateway {
    http_client: reqwest::Client,
    api_url: String,
    api_key: Option<String>,
}

impl ReqwestOpenRouterGateway {
    /// Constructs gateway config from process environment.
    pub fn from_env() -> Self {
        let api_key = env::var("OPENROUTER_API_KEY")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        Self {
            http_client: reqwest::Client::new(),
            api_url: OPENROUTER_API_URL.to_string(),
            api_key,
        }
    }
}

impl ChatCompletionGateway for ReqwestOpenRouterGateway {
    fn post_chat_completions(&self, model_id: &str, messages: &[Value]) -> ChatGatewayFuture<'_> {
        let model_id = model_id.to_string();
        let messages = messages.to_vec();

        Box::pin(async move {
            let Some(api_key) = self.api_key.as_ref() else {
                return OpenRouterChatCompletionResult::new(
                    500,
                    json!({
                        "error": "OPENROUTER_API_KEY is not configured on the server"
                    }),
                );
            };

            let request_body = match serde_json::to_vec(&json!({
                "model": model_id,
                "messages": messages,
            })) {
                Ok(value) => value,
                Err(error) => {
                    tracing::error!("failed to serialize openrouter request payload: {error}");
                    return OpenRouterChatCompletionResult::new(
                        500,
                        json!({ "error": "Failed to build OpenRouter request payload" }),
                    );
                }
            };

            let response = match self
                .http_client
                .post(&self.api_url)
                .header("Authorization", format!("Bearer {api_key}"))
                .header("Content-Type", "application/json")
                .body(request_body)
                .send()
                .await
            {
                Ok(value) => value,
                Err(error) => {
                    tracing::error!("openrouter request failed: {error}");
                    return OpenRouterChatCompletionResult::new(
                        502,
                        json!({ "error": "Failed to contact OpenRouter" }),
                    );
                }
            };

            let status = response.status().as_u16();
            let response_text = match response.text().await {
                Ok(value) => value,
                Err(error) => {
                    tracing::error!("failed to read openrouter response body: {error}");
                    return OpenRouterChatCompletionResult::new(
                        502,
                        json!({ "error": "Failed to contact OpenRouter" }),
                    );
                }
            };

            let payload = parse_openrouter_response_payload(&response_text);
            OpenRouterChatCompletionResult::new(status, payload)
        })
    }
}

/// Trait-backed implementation of `tearleads.v2.ChatService`.
pub struct ChatServiceHandler<G = ReqwestOpenRouterGateway, A = JwtSessionBillingAuthorizer> {
    gateway: G,
    authorizer: A,
}

impl<G, A> ChatServiceHandler<G, A> {
    /// Creates a chat handler from gateway and auth policy implementations.
    pub fn with_gateway_and_authorizer(gateway: G, authorizer: A) -> Self {
        Self {
            gateway,
            authorizer,
        }
    }
}

impl ChatServiceHandler<ReqwestOpenRouterGateway, JwtSessionBillingAuthorizer> {
    /// Creates a new chat handler using runtime gateway + auth policy.
    pub fn new() -> Self {
        Self::with_gateway_and_authorizer(
            ReqwestOpenRouterGateway::from_env(),
            JwtSessionBillingAuthorizer::from_env(),
        )
    }
}

#[tonic::async_trait]
impl<G, A> ChatService for ChatServiceHandler<G, A>
where
    G: ChatCompletionGateway + Send + Sync + 'static,
    A: BillingRequestAuthorizer + Send + Sync + 'static,
{
    async fn post_completions(
        &self,
        request: Request<ChatServicePostCompletionsRequest>,
    ) -> Result<Response<ChatServicePostCompletionsResponse>, Status> {
        self.authorizer
            .authorize_billing_request(request.metadata())
            .await
            .map_err(map_billing_auth_error)?;

        let payload = request.into_inner();
        let body = parse_json_request_body(&payload.json)?;
        let parsed = parse_chat_completions_body(&body)?;
        let result = self
            .gateway
            .post_chat_completions(&parsed.model_id, &parsed.messages)
            .await;

        if !(200..300).contains(&result.status) {
            let fallback = if result.status == 401 {
                String::from("OpenRouter denied authentication - check your API key")
            } else {
                format!("Chat completion failed with status {}", result.status)
            };
            let message = error_message_from_payload(&result.payload, fallback);
            return Err(Status::new(
                connect_code_from_http_status(result.status),
                message,
            ));
        }

        Ok(Response::new(ChatServicePostCompletionsResponse {
            json: to_json_response_payload(&result.payload),
        }))
    }
}

#[derive(Debug, Clone)]
struct ParsedChatCompletionPayload {
    messages: Vec<Value>,
    model_id: String,
}

fn parse_json_request_body(raw_json: &str) -> Result<Value, Status> {
    let body = if raw_json.trim().is_empty() {
        "{}"
    } else {
        raw_json
    };

    serde_json::from_str(body).map_err(|_| Status::invalid_argument("Invalid JSON payload"))
}

fn parse_chat_completions_body(body: &Value) -> Result<ParsedChatCompletionPayload, Status> {
    let object = body
        .as_object()
        .ok_or_else(|| Status::invalid_argument("messages must be a non-empty array"))?;

    let messages_value = object
        .get("messages")
        .ok_or_else(|| Status::invalid_argument("messages must be a non-empty array"))?;
    let messages = validate_chat_messages(messages_value)?;

    let model_id = match object.get("model") {
        None => DEFAULT_OPENROUTER_MODEL_ID.to_string(),
        Some(value) => {
            let Some(model) = value.as_str() else {
                return Err(Status::invalid_argument(
                    "model must be a supported OpenRouter chat model",
                ));
            };
            if !SUPPORTED_OPENROUTER_MODEL_IDS.contains(&model) {
                return Err(Status::invalid_argument(
                    "model must be a supported OpenRouter chat model",
                ));
            }
            model.to_string()
        }
    };

    Ok(ParsedChatCompletionPayload { messages, model_id })
}

fn validate_chat_messages(value: &Value) -> Result<Vec<Value>, Status> {
    let messages = value
        .as_array()
        .ok_or_else(|| Status::invalid_argument("messages must be a non-empty array"))?;
    if messages.is_empty() {
        return Err(Status::invalid_argument(
            "messages must be a non-empty array",
        ));
    }

    let mut validated = Vec::with_capacity(messages.len());
    for (message_index, entry) in messages.iter().enumerate() {
        let object = entry.as_object().ok_or_else(|| {
            Status::invalid_argument(format!("messages[{message_index}] must be an object"))
        })?;

        let role = object.get("role").and_then(Value::as_str).ok_or_else(|| {
            Status::invalid_argument(format!(
                "messages[{message_index}].role must be one of: system, user, assistant, tool"
            ))
        })?;
        if !matches!(role, "assistant" | "system" | "tool" | "user") {
            return Err(Status::invalid_argument(format!(
                "messages[{message_index}].role must be one of: system, user, assistant, tool"
            )));
        }

        validate_message_content(message_index, object)?;
        validated.push(entry.clone());
    }

    Ok(validated)
}

fn validate_message_content(
    message_index: usize,
    object: &Map<String, Value>,
) -> Result<(), Status> {
    let prefix = format!("messages[{message_index}].content");
    let Some(content) = object.get("content") else {
        return Err(Status::invalid_argument(format!(
            "{prefix} must be a non-empty string or array"
        )));
    };

    if let Some(content_text) = content.as_str() {
        if content_text.trim().is_empty() {
            return Err(Status::invalid_argument(format!(
                "{prefix} must be a non-empty string"
            )));
        }
        return Ok(());
    }

    let parts = content.as_array().ok_or_else(|| {
        Status::invalid_argument(format!("{prefix} must be a non-empty string or array"))
    })?;
    if parts.is_empty() {
        return Err(Status::invalid_argument(format!(
            "{prefix} must be a non-empty array"
        )));
    }

    for (part_index, part) in parts.iter().enumerate() {
        validate_content_part(message_index, part_index, part)?;
    }
    Ok(())
}

fn validate_content_part(
    message_index: usize,
    part_index: usize,
    part: &Value,
) -> Result<(), Status> {
    let prefix = format!("messages[{message_index}].content[{part_index}]");
    let object = part
        .as_object()
        .ok_or_else(|| Status::invalid_argument(format!("{prefix} must be an object")))?;

    let part_type = object.get("type").and_then(Value::as_str).ok_or_else(|| {
        Status::invalid_argument(format!("{prefix}.type must be \"text\" or \"image_url\""))
    })?;

    match part_type {
        "text" => {
            let Some(text) = object.get("text").and_then(Value::as_str) else {
                return Err(Status::invalid_argument(format!(
                    "{prefix}.text must be a non-empty string"
                )));
            };
            if text.trim().is_empty() {
                return Err(Status::invalid_argument(format!(
                    "{prefix}.text must be a non-empty string"
                )));
            }
            Ok(())
        }
        "image_url" => {
            let image_url = object
                .get("image_url")
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    Status::invalid_argument(format!("{prefix}.image_url must be an object"))
                })?;
            let Some(url) = image_url.get("url").and_then(Value::as_str) else {
                return Err(Status::invalid_argument(format!(
                    "{prefix}.image_url.url must be a non-empty string"
                )));
            };
            if url.trim().is_empty() {
                return Err(Status::invalid_argument(format!(
                    "{prefix}.image_url.url must be a non-empty string"
                )));
            }
            Ok(())
        }
        _ => Err(Status::invalid_argument(format!(
            "{prefix}.type must be \"text\" or \"image_url\""
        ))),
    }
}

fn parse_openrouter_response_payload(response_text: &str) -> Value {
    if response_text.trim().is_empty() {
        return json!({});
    }

    serde_json::from_str(response_text).unwrap_or_else(|_| json!({ "error": response_text }))
}

fn error_message_from_payload(payload: &Value, fallback: String) -> String {
    payload
        .as_object()
        .and_then(|value| value.get("error"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or(fallback)
}

fn to_json_response_payload(payload: &Value) -> String {
    serde_json::to_string(payload).unwrap_or_else(|_| String::from("{}"))
}

fn connect_code_from_http_status(status: u16) -> Code {
    match status {
        400 => Code::InvalidArgument,
        401 => Code::Unauthenticated,
        403 => Code::PermissionDenied,
        404 => Code::NotFound,
        409 => Code::AlreadyExists,
        412 => Code::FailedPrecondition,
        429 => Code::ResourceExhausted,
        501 => Code::Unimplemented,
        503 => Code::Unavailable,
        504 => Code::DeadlineExceeded,
        500..=599 => Code::Internal,
        _ => Code::Unknown,
    }
}

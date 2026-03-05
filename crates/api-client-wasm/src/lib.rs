//! WASM bindings for API v2 Rust client foundations.

#[cfg(any(test, target_arch = "wasm32"))]
use serde::Serialize;
#[cfg(any(test, target_arch = "wasm32"))]
use std::collections::BTreeMap;
#[cfg(any(test, target_arch = "wasm32"))]
use tearleads_api_client_rs::ApiClientRequestContext;
#[cfg(any(test, target_arch = "wasm32"))]
use tearleads_api_client_rs::protocol_config;
use tearleads_api_client_rs::{normalize_connect_base_url, resolve_rpc_path};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg(any(test, target_arch = "wasm32"))]
struct HeaderMap {
    headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg(any(test, target_arch = "wasm32"))]
struct ProtocolConfigEnvelope {
    connect_prefix: String,
    admin_service_name: String,
    mls_service_name: String,
    authorization_header: String,
    organization_header: String,
}

#[cfg(any(test, target_arch = "wasm32"))]
fn build_request_headers_inner(
    bearer_token: Option<String>,
    organization_id: Option<String>,
) -> HeaderMap {
    let context = ApiClientRequestContext {
        bearer_token,
        organization_id,
    };

    HeaderMap {
        headers: context.header_pairs().into_iter().collect(),
    }
}

#[cfg(any(test, target_arch = "wasm32"))]
fn build_protocol_config_inner() -> ProtocolConfigEnvelope {
    let config = protocol_config();
    ProtocolConfigEnvelope {
        connect_prefix: config.connect_prefix.to_string(),
        admin_service_name: config.admin_service_name.to_string(),
        mls_service_name: config.mls_service_name.to_string(),
        authorization_header: config.authorization_header.to_string(),
        organization_header: config.organization_header.to_string(),
    }
}

/// Normalizes an API base URL into a Connect-prefixed URL for v2 RPC calls.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen(js_name = normalizeConnectBaseUrl))]
pub fn normalize_connect_base_url_binding(base_url: &str) -> String {
    normalize_connect_base_url(base_url)
}

/// Resolves a canonical v2 RPC path for any service and method pair.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen(js_name = resolveRpcPath))]
pub fn resolve_rpc_path_binding(service_name: &str, method_name: &str) -> String {
    resolve_rpc_path(service_name, method_name)
}

/// Builds request headers from optional auth and organization context.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = buildRequestHeaders)]
pub fn build_request_headers_binding(
    bearer_token: Option<String>,
    organization_id: Option<String>,
) -> Result<JsValue, JsValue> {
    let headers = build_request_headers_inner(bearer_token, organization_id);
    serde_wasm_bindgen::to_value(&headers)
        .map_err(|error| JsValue::from_str(&format!("failed to encode headers: {error}")))
}

/// Returns canonical protocol constants shared by API v2 clients.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = getProtocolConfig)]
pub fn get_protocol_config_binding() -> Result<JsValue, JsValue> {
    let config = build_protocol_config_inner();
    serde_wasm_bindgen::to_value(&config)
        .map_err(|error| JsValue::from_str(&format!("failed to encode protocol config: {error}")))
}

#[cfg(test)]
mod tests {
    use super::{
        build_protocol_config_inner, build_request_headers_inner,
        normalize_connect_base_url_binding, resolve_rpc_path_binding,
    };

    #[test]
    fn connect_base_url_normalization_matches_expected_paths() {
        assert_eq!(
            normalize_connect_base_url_binding("https://api.example.com"),
            "https://api.example.com/connect"
        );
        assert_eq!(
            normalize_connect_base_url_binding("https://api.example.com/connect"),
            "https://api.example.com/connect"
        );
        assert_eq!(normalize_connect_base_url_binding(""), "/connect");
    }

    #[test]
    fn resolve_rpc_path_binding_matches_expected_values() {
        assert_eq!(
            resolve_rpc_path_binding("tearleads.v2.AdminService", "GetPostgresInfo"),
            "/tearleads.v2.AdminService/GetPostgresInfo"
        );
        assert_eq!(
            resolve_rpc_path_binding("tearleads.v2.AdminService", "GetTables"),
            "/tearleads.v2.AdminService/GetTables"
        );
        assert_eq!(
            resolve_rpc_path_binding("tearleads.v2.AdminService", "GetColumns"),
            "/tearleads.v2.AdminService/GetColumns"
        );
        assert_eq!(
            resolve_rpc_path_binding("tearleads.v2.AdminService", "GetRows"),
            "/tearleads.v2.AdminService/GetRows"
        );
        assert_eq!(
            resolve_rpc_path_binding("tearleads.v2.AdminService", "GetRedisKeys"),
            "/tearleads.v2.AdminService/GetRedisKeys"
        );
        assert_eq!(
            resolve_rpc_path_binding("tearleads.v2.AdminService", "GetRedisValue"),
            "/tearleads.v2.AdminService/GetRedisValue"
        );
        assert_eq!(
            resolve_rpc_path_binding("tearleads.v2.AdminService", "DeleteRedisKey"),
            "/tearleads.v2.AdminService/DeleteRedisKey"
        );
        assert_eq!(
            resolve_rpc_path_binding("tearleads.v2.AdminService", "GetRedisDbSize"),
            "/tearleads.v2.AdminService/GetRedisDbSize"
        );
    }

    #[test]
    fn protocol_config_binding_payload_matches_expected_values() {
        let config = build_protocol_config_inner();

        assert_eq!(config.connect_prefix, "/connect");
        assert_eq!(config.admin_service_name, "tearleads.v2.AdminService");
        assert_eq!(config.mls_service_name, "tearleads.v2.MlsService");
        assert_eq!(config.authorization_header, "authorization");
        assert_eq!(config.organization_header, "x-tearleads-organization-id");
    }

    #[test]
    fn request_headers_include_auth_and_organization_context() {
        let headers = build_request_headers_inner(
            Some(String::from("token-abc")),
            Some(String::from("org_123")),
        );

        assert_eq!(
            headers.headers.get("authorization"),
            Some(&String::from("Bearer token-abc"))
        );
        assert_eq!(
            headers.headers.get("x-tearleads-organization-id"),
            Some(&String::from("org_123"))
        );
    }

    #[test]
    fn request_headers_omit_blank_values() {
        let headers = build_request_headers_inner(Some(String::from("   ")), Some(String::new()));
        assert!(headers.headers.is_empty());
    }
}

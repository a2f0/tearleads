//! WASM bindings for API v2 Rust client foundations.

#[cfg(any(test, target_arch = "wasm32"))]
use serde::Serialize;
#[cfg(any(test, target_arch = "wasm32"))]
use std::collections::BTreeMap;
#[cfg(any(test, target_arch = "wasm32"))]
use tearleads_api_client_rs::ApiClientRequestContext;
use tearleads_api_client_rs::{
    admin_get_columns_path, admin_get_postgres_info_path, admin_get_redis_db_size_path,
    admin_get_redis_keys_path, admin_get_redis_value_path, admin_get_rows_path,
    admin_get_tables_path, normalize_connect_base_url,
};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg(any(test, target_arch = "wasm32"))]
struct HeaderMap {
    headers: BTreeMap<String, String>,
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

/// Normalizes an API base URL into a Connect-prefixed URL for v2 RPC calls.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen(js_name = normalizeConnectBaseUrl))]
pub fn normalize_connect_base_url_binding(base_url: &str) -> String {
    normalize_connect_base_url(base_url)
}

/// Returns canonical v2 admin `GetPostgresInfo` path.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen(js_name = adminGetPostgresInfoPath))]
pub fn admin_get_postgres_info_path_binding() -> String {
    admin_get_postgres_info_path()
}

/// Returns canonical v2 admin `GetTables` path.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen(js_name = adminGetTablesPath))]
pub fn admin_get_tables_path_binding() -> String {
    admin_get_tables_path()
}

/// Returns canonical v2 admin `GetColumns` path.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen(js_name = adminGetColumnsPath))]
pub fn admin_get_columns_path_binding() -> String {
    admin_get_columns_path()
}

/// Returns canonical v2 admin `GetRows` path.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen(js_name = adminGetRowsPath))]
pub fn admin_get_rows_path_binding() -> String {
    admin_get_rows_path()
}

/// Returns canonical v2 admin `GetRedisKeys` path.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen(js_name = adminGetRedisKeysPath))]
pub fn admin_get_redis_keys_path_binding() -> String {
    admin_get_redis_keys_path()
}

/// Returns canonical v2 admin `GetRedisValue` path.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen(js_name = adminGetRedisValuePath))]
pub fn admin_get_redis_value_path_binding() -> String {
    admin_get_redis_value_path()
}

/// Returns canonical v2 admin `GetRedisDbSize` path.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen(js_name = adminGetRedisDbSizePath))]
pub fn admin_get_redis_db_size_path_binding() -> String {
    admin_get_redis_db_size_path()
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

#[cfg(test)]
mod tests {
    use super::{
        admin_get_columns_path_binding, admin_get_postgres_info_path_binding,
        admin_get_redis_db_size_path_binding, admin_get_redis_keys_path_binding,
        admin_get_redis_value_path_binding, admin_get_rows_path_binding,
        admin_get_tables_path_binding, build_request_headers_inner,
        normalize_connect_base_url_binding,
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
    fn rpc_path_bindings_match_admin_contract_methods() {
        assert_eq!(
            admin_get_postgres_info_path_binding(),
            "/tearleads.v2.AdminService/GetPostgresInfo"
        );
        assert_eq!(
            admin_get_tables_path_binding(),
            "/tearleads.v2.AdminService/GetTables"
        );
        assert_eq!(
            admin_get_columns_path_binding(),
            "/tearleads.v2.AdminService/GetColumns"
        );
        assert_eq!(
            admin_get_rows_path_binding(),
            "/tearleads.v2.AdminService/GetRows"
        );
        assert_eq!(
            admin_get_redis_keys_path_binding(),
            "/tearleads.v2.AdminService/GetRedisKeys"
        );
        assert_eq!(
            admin_get_redis_value_path_binding(),
            "/tearleads.v2.AdminService/GetRedisValue"
        );
        assert_eq!(
            admin_get_redis_db_size_path_binding(),
            "/tearleads.v2.AdminService/GetRedisDbSize"
        );
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

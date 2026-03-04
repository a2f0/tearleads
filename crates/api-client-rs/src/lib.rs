//! Typed Rust client foundations for API v2.

/// Re-export generated v2 contract modules.
pub use tearleads_api_v2_contracts::tearleads::v2;

/// Canonical Connect prefix.
pub const CONNECT_PREFIX: &str = "/connect";
/// Canonical admin service name in v2 contracts.
pub const ADMIN_SERVICE_NAME: &str = "tearleads.v2.AdminService";
/// Canonical MLS service name in v2 contracts.
pub const MLS_SERVICE_NAME: &str = "tearleads.v2.MlsService";
/// Authorization header key.
pub const AUTHORIZATION_HEADER: &str = "authorization";
/// Organization header key for request scoping.
pub const ORGANIZATION_HEADER: &str = "x-tearleads-organization-id";

/// Request-scoped metadata used by client transports.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ApiClientRequestContext {
    /// Optional bearer token value (with or without `Bearer ` prefix).
    pub bearer_token: Option<String>,
    /// Optional organization identifier for request scoping.
    pub organization_id: Option<String>,
}

impl ApiClientRequestContext {
    /// Converts this request context to lowercase header pairs.
    pub fn header_pairs(&self) -> Vec<(String, String)> {
        let mut pairs = Vec::new();

        if let Some(token) = normalize_bearer_token(self.bearer_token.as_deref()) {
            pairs.push((AUTHORIZATION_HEADER.to_owned(), token));
        }

        if let Some(organization_id) = normalize_non_empty(self.organization_id.as_deref()) {
            pairs.push((ORGANIZATION_HEADER.to_owned(), organization_id));
        }

        pairs
    }
}

/// Normalizes an API base URL into a Connect-prefixed base URL.
pub fn normalize_connect_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim();
    let without_trailing_slash = trimmed.trim_end_matches('/');

    if without_trailing_slash.is_empty() {
        return CONNECT_PREFIX.to_owned();
    }

    if without_trailing_slash.ends_with(CONNECT_PREFIX) {
        return without_trailing_slash.to_owned();
    }

    format!("{without_trailing_slash}{CONNECT_PREFIX}")
}

/// Builds a canonical RPC path for a service and method.
pub fn rpc_path(service_name: &str, method_name: &str) -> String {
    format!("/{service_name}/{method_name}")
}

/// Returns the canonical v2 admin RPC path for `GetPostgresInfo`.
pub fn admin_get_postgres_info_path() -> String {
    rpc_path(ADMIN_SERVICE_NAME, "GetPostgresInfo")
}

/// Returns the canonical v2 admin RPC path for `GetTables`.
pub fn admin_get_tables_path() -> String {
    rpc_path(ADMIN_SERVICE_NAME, "GetTables")
}

/// Returns the canonical v2 admin RPC path for `GetColumns`.
pub fn admin_get_columns_path() -> String {
    rpc_path(ADMIN_SERVICE_NAME, "GetColumns")
}

/// Returns the canonical v2 admin RPC path for `GetRedisKeys`.
pub fn admin_get_redis_keys_path() -> String {
    rpc_path(ADMIN_SERVICE_NAME, "GetRedisKeys")
}

/// Returns the canonical v2 admin RPC path for `GetRedisValue`.
pub fn admin_get_redis_value_path() -> String {
    rpc_path(ADMIN_SERVICE_NAME, "GetRedisValue")
}

/// Returns generated client type names to enforce compile-time linkage.
pub fn generated_client_type_names() -> (&'static str, &'static str) {
    (
        std::any::type_name::<v2::admin_service_client::AdminServiceClient<()>>(),
        std::any::type_name::<v2::mls_service_client::MlsServiceClient<()>>(),
    )
}

fn normalize_non_empty(value: Option<&str>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_owned())
        }
    })
}

fn normalize_bearer_token(value: Option<&str>) -> Option<String> {
    let normalized = normalize_non_empty(value)?;
    if normalized.starts_with("Bearer ") {
        Some(normalized)
    } else {
        Some(format!("Bearer {normalized}"))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ApiClientRequestContext, admin_get_columns_path, admin_get_postgres_info_path,
        admin_get_redis_keys_path, admin_get_redis_value_path, admin_get_tables_path,
        generated_client_type_names, normalize_connect_base_url, rpc_path,
    };

    #[test]
    fn normalizes_connect_base_url_variants() {
        assert_eq!(
            normalize_connect_base_url("https://api.example.com"),
            "https://api.example.com/connect"
        );
        assert_eq!(
            normalize_connect_base_url("https://api.example.com/connect"),
            "https://api.example.com/connect"
        );
        assert_eq!(
            normalize_connect_base_url(" https://api.example.com/v2/ "),
            "https://api.example.com/v2/connect"
        );
        assert_eq!(normalize_connect_base_url(""), "/connect");
    }

    #[test]
    fn request_context_builds_header_pairs() {
        let context = ApiClientRequestContext {
            bearer_token: Some(String::from("token-123")),
            organization_id: Some(String::from("org_abc")),
        };

        assert_eq!(
            context.header_pairs(),
            vec![
                (
                    String::from("authorization"),
                    String::from("Bearer token-123")
                ),
                (
                    String::from("x-tearleads-organization-id"),
                    String::from("org_abc"),
                ),
            ]
        );
    }

    #[test]
    fn request_context_ignores_blank_headers() {
        let context = ApiClientRequestContext {
            bearer_token: Some(String::from("   ")),
            organization_id: Some(String::from("")),
        };

        assert!(context.header_pairs().is_empty());
    }

    #[test]
    fn request_context_preserves_bearer_prefix() {
        let context = ApiClientRequestContext {
            bearer_token: Some(String::from("Bearer keep-me")),
            organization_id: None,
        };

        assert_eq!(
            context.header_pairs(),
            vec![(
                String::from("authorization"),
                String::from("Bearer keep-me")
            )]
        );
    }

    #[test]
    fn rpc_paths_match_v2_admin_methods() {
        assert_eq!(
            admin_get_postgres_info_path(),
            "/tearleads.v2.AdminService/GetPostgresInfo"
        );
        assert_eq!(
            admin_get_tables_path(),
            "/tearleads.v2.AdminService/GetTables"
        );
        assert_eq!(
            admin_get_columns_path(),
            "/tearleads.v2.AdminService/GetColumns"
        );
        assert_eq!(
            admin_get_redis_keys_path(),
            "/tearleads.v2.AdminService/GetRedisKeys"
        );
        assert_eq!(
            admin_get_redis_value_path(),
            "/tearleads.v2.AdminService/GetRedisValue"
        );
        assert_eq!(
            rpc_path("tearleads.v2.MlsService", "GetGroup"),
            "/tearleads.v2.MlsService/GetGroup"
        );
    }

    #[test]
    fn generated_client_types_are_linked() {
        let (admin_client_type_name, mls_client_type_name) = generated_client_type_names();
        assert!(admin_client_type_name.contains("AdminServiceClient"));
        assert!(mls_client_type_name.contains("MlsServiceClient"));
    }
}

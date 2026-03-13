//! Typed Rust client foundations for API v2.

#[cfg(feature = "transport")]
mod execution;

#[cfg(feature = "transport")]
pub use execution::{AdminRpcClient, ApiClientRpcError};
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

/// Canonical protocol constants shared across API v2 client layers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ApiProtocolConfig {
    /// Canonical Connect path prefix.
    pub connect_prefix: &'static str,
    /// Canonical admin service type name.
    pub admin_service_name: &'static str,
    /// Canonical MLS service type name.
    pub mls_service_name: &'static str,
    /// Authorization header key.
    pub authorization_header: &'static str,
    /// Organization header key for request scoping.
    pub organization_header: &'static str,
}

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

/// Returns canonical protocol constants for API v2 clients.
pub fn protocol_config() -> ApiProtocolConfig {
    ApiProtocolConfig {
        connect_prefix: CONNECT_PREFIX,
        admin_service_name: ADMIN_SERVICE_NAME,
        mls_service_name: MLS_SERVICE_NAME,
        authorization_header: AUTHORIZATION_HEADER,
        organization_header: ORGANIZATION_HEADER,
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
pub fn resolve_rpc_path(service_name: &str, method_name: &str) -> String {
    format!("/{service_name}/{method_name}")
}

/// Enforces compile-time linkage to generated service clients.
pub fn generated_client_compile_proof() {
    let _ = std::marker::PhantomData::<v2::admin_service_client::AdminServiceClient<()>>;
    let _ = std::marker::PhantomData::<v2::mls_service_client::MlsServiceClient<()>>;
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
    let has_bearer_prefix =
        normalized.len() >= 7 && normalized[..7].eq_ignore_ascii_case("bearer ");
    if has_bearer_prefix {
        Some(normalized)
    } else {
        Some(format!("Bearer {normalized}"))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ADMIN_SERVICE_NAME, ApiClientRequestContext, generated_client_compile_proof,
        normalize_connect_base_url, protocol_config, resolve_rpc_path,
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
            resolve_rpc_path(ADMIN_SERVICE_NAME, "GetContext"),
            "/tearleads.v2.AdminService/GetContext"
        );
        assert_eq!(
            resolve_rpc_path(ADMIN_SERVICE_NAME, "ListGroups"),
            "/tearleads.v2.AdminService/ListGroups"
        );
        assert_eq!(
            resolve_rpc_path(ADMIN_SERVICE_NAME, "GetPostgresInfo"),
            "/tearleads.v2.AdminService/GetPostgresInfo"
        );
        assert_eq!(
            resolve_rpc_path(ADMIN_SERVICE_NAME, "GetTables"),
            "/tearleads.v2.AdminService/GetTables"
        );
        assert_eq!(
            resolve_rpc_path(ADMIN_SERVICE_NAME, "GetColumns"),
            "/tearleads.v2.AdminService/GetColumns"
        );
        assert_eq!(
            resolve_rpc_path(ADMIN_SERVICE_NAME, "GetRows"),
            "/tearleads.v2.AdminService/GetRows"
        );
        assert_eq!(
            resolve_rpc_path(ADMIN_SERVICE_NAME, "GetRedisKeys"),
            "/tearleads.v2.AdminService/GetRedisKeys"
        );
        assert_eq!(
            resolve_rpc_path(ADMIN_SERVICE_NAME, "GetRedisValue"),
            "/tearleads.v2.AdminService/GetRedisValue"
        );
        assert_eq!(
            resolve_rpc_path(ADMIN_SERVICE_NAME, "DeleteRedisKey"),
            "/tearleads.v2.AdminService/DeleteRedisKey"
        );
        assert_eq!(
            resolve_rpc_path(ADMIN_SERVICE_NAME, "GetRedisDbSize"),
            "/tearleads.v2.AdminService/GetRedisDbSize"
        );
        assert_eq!(
            resolve_rpc_path("tearleads.v2.MlsService", "GetGroup"),
            "/tearleads.v2.MlsService/GetGroup"
        );
    }

    #[test]
    fn protocol_config_is_stable() {
        let config = protocol_config();

        assert_eq!(config.connect_prefix, "/connect");
        assert_eq!(config.admin_service_name, "tearleads.v2.AdminService");
        assert_eq!(config.mls_service_name, "tearleads.v2.MlsService");
        assert_eq!(config.authorization_header, "authorization");
        assert_eq!(config.organization_header, "x-tearleads-organization-id");
    }

    #[test]
    fn request_context_preserves_case_insensitive_bearer_prefix() {
        let context = ApiClientRequestContext {
            bearer_token: Some(String::from("bearer keep-me")),
            organization_id: None,
        };

        assert_eq!(
            context.header_pairs(),
            vec![(
                String::from("authorization"),
                String::from("bearer keep-me")
            )]
        );
    }

    #[test]
    fn generated_client_types_are_linked() {
        generated_client_compile_proof();
    }
}

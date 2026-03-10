//! API v2 router and handlers.

mod admin_auth;
mod admin_harness;
mod admin_service;
mod admin_service_common;
mod ping;

use axum::{Router, routing::get};
use tearleads_api_v2_contracts::tearleads::v2::admin_service_server::AdminServiceServer;
use tower::ServiceExt;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

const ADMIN_HARNESS_ENV_KEY: &str = "API_V2_ENABLE_ADMIN_HARNESS";

pub use admin_auth::{
    AdminAccessContext, AdminAuthError, AdminAuthErrorKind, AdminOperation, AdminRequestAuthorizer,
    HeaderRoleAdminAuthorizer,
};
pub use admin_service::AdminServiceHandler;
pub use ping::PingResponse;
use ping::ping;

/// Builds the router with the given comma-separated allowed origins.
///
/// When `origins` is empty, all origins are allowed (local development).
/// Otherwise only the listed origins are accepted.
pub fn app_with_origins(origins: &str) -> Router {
    app_with_harness_flag(origins, should_enable_admin_harness())
}

fn app_with_harness_flag(origins: &str, enable_admin_harness: bool) -> Router {
    let router = Router::new()
        .route("/v2/ping", get(ping))
        .layer(cors_layer(origins))
        .layer(TraceLayer::new_for_http());

    if enable_admin_harness {
        let admin_service = tower::ServiceBuilder::new()
            .layer(tonic_web::GrpcWebLayer::new())
            .service(AdminServiceServer::new(
                admin_harness::create_admin_harness_handler(),
            ))
            .map_request(|request: axum::http::Request<axum::body::Body>| {
                request.map(tonic::body::Body::new)
            });
        let admin_service_v1_prefixed = tower::ServiceBuilder::new()
            .layer(tonic_web::GrpcWebLayer::new())
            .service(AdminServiceServer::new(
                admin_harness::create_admin_harness_handler(),
            ))
            .map_request(|request: axum::http::Request<axum::body::Body>| {
                request.map(tonic::body::Body::new)
            });
        router
            .nest_service("/connect", admin_service)
            .nest_service("/v1/connect", admin_service_v1_prefixed)
    } else {
        router
    }
}

fn cors_layer(origins: &str) -> CorsLayer {
    if origins.is_empty() {
        return CorsLayer::permissive();
    }

    let parsed: Vec<_> = origins
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect();

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(parsed))
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any)
}

fn should_enable_admin_harness() -> bool {
    let value = std::env::var(ADMIN_HARNESS_ENV_KEY).unwrap_or_default();
    is_truthy_env_flag(&value)
}

fn is_truthy_env_flag(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use super::{app_with_harness_flag, is_truthy_env_flag};

    #[test]
    fn truthy_flag_parsing_is_stable() {
        assert!(is_truthy_env_flag("1"));
        assert!(is_truthy_env_flag("TRUE"));
        assert!(is_truthy_env_flag(" yes "));
        assert!(is_truthy_env_flag("On"));
        assert!(!is_truthy_env_flag("0"));
        assert!(!is_truthy_env_flag("false"));
        assert!(!is_truthy_env_flag(""));
    }

    fn admin_tables_request(path: &str) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/grpc-web+proto")
            .header("x-grpc-web", "1")
            .header("authorization", "Bearer header.payload.signature")
            .body(Body::empty())
            .expect("request should build")
    }

    #[tokio::test]
    async fn harness_flag_controls_connect_route_mounting() {
        let without_harness = app_with_harness_flag("", false)
            .oneshot(admin_tables_request(
                "/connect/tearleads.v2.AdminService/GetTables",
            ))
            .await
            .expect("router should return a response");
        assert_eq!(without_harness.status(), StatusCode::NOT_FOUND);

        let with_harness_result = app_with_harness_flag("", true)
            .oneshot(admin_tables_request(
                "/connect/tearleads.v2.AdminService/GetTables",
            ))
            .await;
        let with_harness = with_harness_result.expect("router should return a response");
        assert_ne!(with_harness.status(), StatusCode::NOT_FOUND);

        let without_harness_v1_prefixed = app_with_harness_flag("", false)
            .oneshot(admin_tables_request(
                "/v1/connect/tearleads.v2.AdminService/GetTables",
            ))
            .await
            .expect("router should return a response");
        assert_eq!(without_harness_v1_prefixed.status(), StatusCode::NOT_FOUND);

        let with_harness_v1_prefixed_result = app_with_harness_flag("", true)
            .oneshot(admin_tables_request(
                "/v1/connect/tearleads.v2.AdminService/GetTables",
            ))
            .await;
        let with_harness_v1_prefixed =
            with_harness_v1_prefixed_result.expect("router should return a response");
        assert_ne!(with_harness_v1_prefixed.status(), StatusCode::NOT_FOUND);
    }
}

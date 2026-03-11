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

pub use admin_auth::{
    AdminAccessContext, AdminAuthError, AdminAuthErrorKind, AdminOperation, AdminRequestAuthorizer,
};
pub use admin_service::AdminServiceHandler;
pub use ping::PingResponse;
use ping::ping;

/// Builds the router with the given comma-separated allowed origins.
///
/// When `origins` is empty, all origins are allowed (local development).
/// Otherwise only the listed origins are accepted.
pub fn app_with_origins(origins: &str) -> Router {
    let build_admin_service = || {
        tower::ServiceBuilder::new()
            .layer(tonic_web::GrpcWebLayer::new())
            .service(AdminServiceServer::new(
                admin_harness::create_admin_handler(),
            ))
            .map_request(|request: axum::http::Request<axum::body::Body>| {
                request.map(tonic::body::Body::new)
            })
    };

    Router::new()
        .route("/v2/ping", get(ping))
        .nest_service("/connect", build_admin_service())
        .nest_service("/v1/connect", build_admin_service())
        .layer(cors_layer(origins))
        .layer(TraceLayer::new_for_http())
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

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use super::app_with_origins;

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
    async fn admin_connect_routes_are_mounted_by_default() {
        let response = app_with_origins("")
            .oneshot(admin_tables_request(
                "/connect/tearleads.v2.AdminService/GetTables",
            ))
            .await
            .expect("router should return a response");
        assert_ne!(response.status(), StatusCode::NOT_FOUND);

        let v1_prefixed = app_with_origins("")
            .oneshot(admin_tables_request(
                "/v1/connect/tearleads.v2.AdminService/GetTables",
            ))
            .await
            .expect("router should return a response");
        assert_ne!(v1_prefixed.status(), StatusCode::NOT_FOUND);
    }
}

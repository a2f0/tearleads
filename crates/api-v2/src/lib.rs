//! API v2 router and handlers.

mod admin_auth;
mod admin_harness;
mod admin_service;
mod ping;

use axum::{Router, routing::get};
use tearleads_api_v2_contracts::tearleads::v2::admin_service_server::AdminServiceServer;
use tonic::body::boxed;
use tower::ServiceExt;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

pub use admin_auth::{
    AdminAuthError, AdminAuthErrorKind, AdminOperation, AdminRequestAuthorizer,
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
    let router = Router::new()
        .route("/v2/ping", get(ping))
        .layer(cors_layer(origins))
        .layer(TraceLayer::new_for_http());

    if should_enable_admin_harness() {
        let admin_handler = admin_harness::create_admin_harness_handler();
        let admin_service = tonic_web::enable(AdminServiceServer::new(admin_handler))
            .map_request(|request: axum::http::Request<axum::body::Body>| request.map(boxed));
        return router.nest_service("/connect", admin_service);
    }

    router
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
    let value = match std::env::var("API_V2_ENABLE_ADMIN_HARNESS") {
        Ok(value) => value,
        Err(_) => return false,
    };

    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

//! API v2 router and handlers.

mod admin_service;
mod ping;

use axum::{Router, routing::get};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

pub use admin_service::AdminServiceHandler;
pub use ping::PingResponse;
use ping::ping;

/// Builds the router with the given comma-separated allowed origins.
///
/// When `origins` is empty, all origins are allowed (local development).
/// Otherwise only the listed origins are accepted.
pub fn app_with_origins(origins: &str) -> Router {
    Router::new()
        .route("/v2/ping", get(ping))
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

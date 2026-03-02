//! API v2 router and handlers.

mod ping;

use axum::{Router, routing::get};
use tower_http::trace::TraceLayer;

pub use ping::PingResponse;
use ping::ping;

/// Builds the API v2 HTTP router.
pub fn app() -> Router {
    Router::new()
        .route("/v2/ping", get(ping))
        .layer(TraceLayer::new_for_http())
}

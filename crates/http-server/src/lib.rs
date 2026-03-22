mod handlers;
mod routes;

use axum::Router;
use std::sync::Arc;
use store::Store;

pub fn app<S: Store + Send + Sync + 'static>(store: S) -> Router {
    let state = Arc::new(store);
    routes::router(state)
}

pub async fn run<S: Store + Send + Sync + 'static>(store: S, addr: &str) -> std::io::Result<()> {
    let app = app(store);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .await
        .map_err(std::io::Error::other)
}

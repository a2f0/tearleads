mod handlers;
mod routes;

use axum::Router;
use std::sync::{Arc, Mutex};
use store::Store;

pub struct AppState<S: Store> {
    pub store: Mutex<S>,
}

pub fn app<S: Store + Send + 'static>(store: S) -> Router {
    let state = Arc::new(AppState {
        store: Mutex::new(store),
    });
    routes::router(state)
}

pub async fn run<S: Store + Send + 'static>(store: S, addr: &str) -> std::io::Result<()> {
    let app = app(store);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .await
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
}

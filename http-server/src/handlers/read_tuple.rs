use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use std::sync::Arc;
use store::Store;

use super::parse_namespace;
use crate::AppState;

pub async fn read_tuple<S: Store + Send + 'static>(
    State(state): State<Arc<AppState<S>>>,
    Path((namespace, object, relation, subject)): Path<(String, String, String, String)>,
) -> impl IntoResponse {
    let namespace = match parse_namespace(&namespace) {
        Ok(ns) => ns,
        Err(e) => return e.into_response(),
    };

    let store = state.store.lock().unwrap();
    match store.read(&namespace, &object, &relation, &subject) {
        Ok(Some(tuple)) => Json(tuple).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use std::sync::Arc;
use store::Store;

use super::parse_namespace;

pub async fn read_tuple<S: Store + Send + Sync + 'static>(
    State(store): State<Arc<S>>,
    Path((namespace, object, relation, subject)): Path<(String, String, String, String)>,
) -> impl IntoResponse {
    let namespace = match parse_namespace(&namespace) {
        Ok(ns) => ns,
        Err(e) => return e.into_response(),
    };

    match store.read(&namespace, &object, &relation, &subject) {
        Ok(Some(tuple)) => Json(tuple).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

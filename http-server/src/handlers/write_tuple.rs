use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use std::sync::Arc;
use store::{Store, Tuple};

use super::parse_namespace;
use crate::AppState;

pub async fn write_tuple<S: Store + Send + 'static>(
    State(state): State<Arc<AppState<S>>>,
    Path((namespace, object, relation, subject)): Path<(String, String, String, String)>,
    body: Bytes,
) -> impl IntoResponse {
    let namespace = match parse_namespace(&namespace) {
        Ok(ns) => ns,
        Err(e) => return e.into_response(),
    };

    let tuple = Tuple {
        namespace,
        object,
        relation,
        subject,
        payload: body.to_vec(),
    };

    let mut store = state.store.lock().unwrap();
    match store.write(tuple) {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

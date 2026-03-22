use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::put;
use axum::{Json, Router};
use protocol::Namespace;
use std::sync::Arc;
use store::{Store, Tuple};

use crate::AppState;

pub fn router<S: Store + Send + 'static>(state: Arc<AppState<S>>) -> Router {
    Router::new()
        .route(
            "/v1/{namespace}/{object}/{relation}/{subject}",
            put(write_tuple::<S>)
                .get(read_tuple::<S>)
                .delete(delete_tuple::<S>),
        )
        .with_state(state)
}

fn parse_namespace(s: &str) -> Result<Namespace, (StatusCode, String)> {
    s.parse::<Namespace>()
        .map_err(|e| (StatusCode::BAD_REQUEST, e))
}

async fn write_tuple<S: Store + Send + 'static>(
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

async fn read_tuple<S: Store + Send + 'static>(
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

async fn delete_tuple<S: Store + Send + 'static>(
    State(state): State<Arc<AppState<S>>>,
    Path((namespace, object, relation, subject)): Path<(String, String, String, String)>,
) -> impl IntoResponse {
    let namespace = match parse_namespace(&namespace) {
        Ok(ns) => ns,
        Err(e) => return e.into_response(),
    };

    let mut store = state.store.lock().unwrap();
    match store.delete(&namespace, &object, &relation, &subject) {
        Ok(deleted) => Json(serde_json::json!({ "deleted": deleted })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use http_body_util::BodyExt;
    use store::memory::MemoryStore;
    use tower::ServiceExt;

    fn test_app() -> Router {
        crate::app(MemoryStore::new())
    }

    #[tokio::test]
    async fn test_write_and_read() {
        let app = test_app();

        let resp = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("PUT")
                    .uri("/v1/node/doc1/owner/alice")
                    .body(Body::from("hello world"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let resp = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/v1/node/doc1/owner/alice")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let tuple: Tuple = serde_json::from_slice(&body).unwrap();
        assert_eq!(tuple.payload, b"hello world");
        assert_eq!(tuple.object, "doc1");
    }

    #[tokio::test]
    async fn test_read_not_found() {
        let app = test_app();

        let resp = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/v1/node/doc1/owner/alice")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_delete() {
        let app = test_app();

        app.clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("PUT")
                    .uri("/v1/node/doc1/owner/alice")
                    .body(Body::from("data"))
                    .unwrap(),
            )
            .await
            .unwrap();

        let resp = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("DELETE")
                    .uri("/v1/node/doc1/owner/alice")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["deleted"], true);

        let resp = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/v1/node/doc1/owner/alice")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_invalid_namespace() {
        let app = test_app();

        let resp = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/v1/invalid/doc1/owner/alice")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}

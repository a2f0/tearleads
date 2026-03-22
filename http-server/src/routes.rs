use axum::routing::put;
use axum::Router;
use std::sync::Arc;
use store::Store;

use crate::handlers::{delete_tuple, read_tuple, write_tuple};
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

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::StatusCode;
    use http_body_util::BodyExt;
    use store::memory::MemoryStore;
    use store::Tuple;
    use tower::ServiceExt;

    fn test_app() -> axum::Router {
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

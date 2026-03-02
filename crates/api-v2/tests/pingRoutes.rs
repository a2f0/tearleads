//! Integration tests for API v2 ping routes.

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

use tearleads_api_v2::app;

#[tokio::test]
async fn ping_path_returns_expected_payload() -> Result<(), Box<dyn std::error::Error>> {
    let request = Request::builder().uri("/ping").body(Body::empty())?;
    let response = app().oneshot(request).await?;

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = response.into_body().collect().await?.to_bytes();
    let payload: Value = serde_json::from_slice(&body_bytes)?;

    assert_eq!(payload["status"], "ok");
    assert_eq!(payload["service"], "api-v2");
    assert_eq!(payload["version"], env!("CARGO_PKG_VERSION"));

    Ok(())
}

#[tokio::test]
async fn prefixed_ping_path_returns_expected_payload() -> Result<(), Box<dyn std::error::Error>> {
    let request = Request::builder().uri("/v2/ping").body(Body::empty())?;
    let response = app().oneshot(request).await?;

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = response.into_body().collect().await?.to_bytes();
    let payload: Value = serde_json::from_slice(&body_bytes)?;

    assert_eq!(payload["status"], "ok");
    assert_eq!(payload["service"], "api-v2");
    assert_eq!(payload["version"], env!("CARGO_PKG_VERSION"));

    Ok(())
}

//! Integration tests for API v2 ping routes.

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

use tearleads_api_v2::app_with_origins;

#[tokio::test]
async fn v2_ping_path_returns_expected_payload() -> Result<(), Box<dyn std::error::Error>> {
    let request = Request::builder().uri("/v2/ping").body(Body::empty())?;
    let response = app_with_origins("").oneshot(request).await?;

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = response.into_body().collect().await?.to_bytes();
    let payload: Value = serde_json::from_slice(&body_bytes)?;

    assert_eq!(payload["status"], "ok");
    assert_eq!(payload["service"], "api-v2");
    assert_eq!(payload["version"], env!("CARGO_PKG_VERSION"));

    Ok(())
}

#[tokio::test]
async fn unversioned_ping_path_returns_not_found() -> Result<(), Box<dyn std::error::Error>> {
    let request = Request::builder().uri("/ping").body(Body::empty())?;
    let response = app_with_origins("").oneshot(request).await?;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    Ok(())
}

#[tokio::test]
async fn cors_allows_listed_origin() -> Result<(), Box<dyn std::error::Error>> {
    let app = app_with_origins("https://app.tearleads.dev,https://tearleads.dev");

    let request = Request::builder()
        .uri("/v2/ping")
        .header(header::ORIGIN, "https://app.tearleads.dev")
        .body(Body::empty())?;
    let response = app.oneshot(request).await?;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .and_then(|v| v.to_str().ok()),
        Some("https://app.tearleads.dev"),
    );

    Ok(())
}

#[tokio::test]
async fn cors_rejects_disallowed_origin() -> Result<(), Box<dyn std::error::Error>> {
    let app = app_with_origins("https://app.tearleads.dev");

    let request = Request::builder()
        .uri("/v2/ping")
        .header(header::ORIGIN, "https://evil.example.com")
        .body(Body::empty())?;
    let response = app.oneshot(request).await?;

    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none(),
        "Access-Control-Allow-Origin must NOT be present for disallowed origin"
    );

    Ok(())
}

#[tokio::test]
async fn cors_permissive_when_origins_empty() -> Result<(), Box<dyn std::error::Error>> {
    let app = app_with_origins("");

    let request = Request::builder()
        .uri("/v2/ping")
        .header(header::ORIGIN, "https://anything.example.com")
        .body(Body::empty())?;
    let response = app.oneshot(request).await?;

    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_some(),
        "Permissive mode should allow any origin"
    );

    Ok(())
}

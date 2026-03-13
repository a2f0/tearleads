//! Router-mount coverage for v2 connect services.

#![allow(clippy::expect_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

use super::admin_harness::StaticPostgresRepository;
use super::{admin_harness_static_redis, app_with_origins, app_with_repos};

fn connect_request(path: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(path)
        .header("content-type", "application/grpc-web+proto")
        .header("x-grpc-web", "1")
        .header("authorization", "Bearer header.payload.signature")
        .body(Body::empty())
        .expect("request should build")
}

async fn assert_mounted(path: &str) {
    let response = app_with_origins("")
        .oneshot(connect_request(path))
        .await
        .expect("router should return a response");
    assert_ne!(response.status(), StatusCode::NOT_FOUND);
}

async fn assert_not_mounted(path: &str) {
    let response = app_with_origins("")
        .oneshot(connect_request(path))
        .await
        .expect("router should return a response");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

async fn assert_mounted_with_repos(path: &str) {
    let response = app_with_repos(
        "",
        StaticPostgresRepository,
        admin_harness_static_redis(),
        StaticPostgresRepository,
    )
    .oneshot(connect_request(path))
    .await
    .expect("router should return a response");
    assert_ne!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn app_with_repos_mounts_connect_routes() {
    let pg = StaticPostgresRepository;
    let rd = admin_harness_static_redis();
    let response = app_with_repos("", pg, rd, StaticPostgresRepository)
        .oneshot(connect_request(
            "/connect/tearleads.v2.AdminService/GetTables",
        ))
        .await
        .expect("router should return a response");
    assert_ne!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn app_with_repos_mounts_all_service_routes() {
    assert_mounted_with_repos("/connect/tearleads.v2.BillingService/GetOrganizationBilling").await;
    assert_mounted_with_repos("/connect/tearleads.v2.ChatService/PostCompletions").await;
    assert_mounted_with_repos("/connect/tearleads.v2.AiService/GetUsage").await;
    assert_mounted_with_repos("/connect/tearleads.v2.AuthService/Login").await;
    assert_mounted_with_repos("/connect/tearleads.v2.MlsService/GetGroup").await;
    assert_mounted_with_repos("/connect/tearleads.v2.NotificationService/Subscribe").await;
    assert_mounted_with_repos("/connect/tearleads.v2.RevenuecatService/HandleWebhook").await;
    assert_mounted_with_repos("/connect/tearleads.v2.VfsService/GetSync").await;
    assert_mounted_with_repos("/connect/tearleads.v2.VfsSharesService/GetItemShares").await;
}

#[tokio::test]
async fn admin_routes_are_mounted_and_v1_alias_not_mounted() {
    assert_mounted("/connect/tearleads.v2.AdminService/GetTables").await;
    assert_not_mounted("/v1/connect/tearleads.v2.AdminService/GetTables").await;
}

#[tokio::test]
async fn billing_routes_are_mounted_and_v1_alias_not_mounted() {
    assert_mounted("/connect/tearleads.v2.BillingService/GetOrganizationBilling").await;
    assert_not_mounted("/v1/connect/tearleads.v2.BillingService/GetOrganizationBilling").await;
}

#[tokio::test]
async fn chat_routes_are_mounted_and_v1_alias_not_mounted() {
    assert_mounted("/connect/tearleads.v2.ChatService/PostCompletions").await;
    assert_not_mounted("/v1/connect/tearleads.v2.ChatService/PostCompletions").await;
}

#[tokio::test]
async fn ai_routes_are_mounted_and_v1_alias_not_mounted() {
    assert_mounted("/connect/tearleads.v2.AiService/GetUsage").await;
    assert_not_mounted("/v1/connect/tearleads.v2.AiService/GetUsage").await;
}

#[tokio::test]
async fn auth_routes_are_mounted_and_v1_alias_not_mounted() {
    assert_mounted("/connect/tearleads.v2.AuthService/Login").await;
    assert_not_mounted("/v1/connect/tearleads.v2.AuthService/Login").await;
}

#[tokio::test]
async fn mls_routes_are_mounted_and_v1_alias_not_mounted() {
    assert_mounted("/connect/tearleads.v2.MlsService/GetGroup").await;
    assert_not_mounted("/v1/connect/tearleads.v2.MlsService/GetGroup").await;
}

#[tokio::test]
async fn notification_routes_are_mounted_and_v1_alias_not_mounted() {
    assert_mounted("/connect/tearleads.v2.NotificationService/Subscribe").await;
    assert_not_mounted("/v1/connect/tearleads.v2.NotificationService/Subscribe").await;
}

#[tokio::test]
async fn revenuecat_routes_are_mounted_and_v1_alias_not_mounted() {
    assert_mounted("/connect/tearleads.v2.RevenuecatService/HandleWebhook").await;
    assert_not_mounted("/v1/connect/tearleads.v2.RevenuecatService/HandleWebhook").await;
}

#[tokio::test]
async fn vfs_routes_are_mounted_and_v1_alias_not_mounted() {
    assert_mounted("/connect/tearleads.v2.VfsService/GetSync").await;
    assert_not_mounted("/v1/connect/tearleads.v2.VfsService/GetSync").await;
}

#[tokio::test]
async fn vfs_shares_routes_are_mounted_and_v1_alias_not_mounted() {
    assert_mounted("/connect/tearleads.v2.VfsSharesService/GetItemShares").await;
    assert_not_mounted("/v1/connect/tearleads.v2.VfsSharesService/GetItemShares").await;
}

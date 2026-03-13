//! API v2 router and handlers.

mod admin_auth;
mod admin_harness;
mod admin_service;
mod admin_service_common;
mod billing_auth;
mod billing_service;
mod chat_service;
mod ping;
/// Concrete Postgres gateway backed by `tokio-postgres` and `deadpool`.
mod postgres_gateway;

use axum::{Router, routing::get};
use tearleads_api_v2_contracts::tearleads::v2::{
    admin_service_server::AdminServiceServer, billing_service_server::BillingServiceServer,
    chat_service_server::ChatServiceServer,
};
use tearleads_data_access_traits::{
    PostgresAdminRepository, PostgresBillingRepository, RedisAdminRepository,
};
use tower::ServiceExt;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

pub use admin_auth::{
    AdminAccessContext, AdminAuthError, AdminAuthErrorKind, AdminOperation, AdminRequestAuthorizer,
};
pub use admin_service::AdminServiceHandler;
pub use billing_auth::{
    AuthorizationHeaderBillingAuthorizer, BillingAccessContext, BillingAuthError,
    BillingAuthErrorKind, BillingRequestAuthorizer, JwtSessionBillingAuthorizer,
};
pub use billing_service::BillingServiceHandler;
pub use chat_service::{
    ChatCompletionGateway, ChatServiceHandler, OpenRouterChatCompletionResult,
    ReqwestOpenRouterGateway,
};
pub use ping::PingResponse;
use ping::ping;
pub use postgres_gateway::TokioPostgresGateway;

/// Builds the router with the given comma-separated allowed origins and
/// repository implementations.
pub fn app_with_repos<P, R, B>(
    origins: &str,
    postgres_repo: P,
    redis_repo: R,
    billing_repo: B,
) -> Router
where
    P: PostgresAdminRepository + Clone + Send + Sync + 'static,
    R: RedisAdminRepository + Clone + Send + Sync + 'static,
    B: PostgresBillingRepository + Clone + Send + Sync + 'static,
{
    app_with_repos_with_billing_authorizer(
        origins,
        postgres_repo,
        redis_repo,
        billing_repo,
        JwtSessionBillingAuthorizer::from_env(),
    )
}

/// Builds the router with repository implementations and explicit billing authorizer.
pub fn app_with_repos_with_billing_authorizer<P, R, B, A>(
    origins: &str,
    postgres_repo: P,
    redis_repo: R,
    billing_repo: B,
    billing_authorizer: A,
) -> Router
where
    P: PostgresAdminRepository + Clone + Send + Sync + 'static,
    R: RedisAdminRepository + Clone + Send + Sync + 'static,
    B: PostgresBillingRepository + Clone + Send + Sync + 'static,
    A: BillingRequestAuthorizer + Clone + Send + Sync + 'static,
{
    let build_connect_routes = {
        let admin_pg = postgres_repo.clone();
        let admin_redis = redis_repo.clone();
        let billing_pg = billing_repo.clone();
        let billing_auth = billing_authorizer.clone();
        move || {
            let admin_service = tower::ServiceBuilder::new()
                .layer(tonic_web::GrpcWebLayer::new())
                .service(AdminServiceServer::new(AdminServiceHandler::new(
                    admin_pg.clone(),
                    admin_redis.clone(),
                )))
                .map_request(|request: axum::http::Request<axum::body::Body>| {
                    request.map(tonic::body::Body::new)
                });
            let billing_service = tower::ServiceBuilder::new()
                .layer(tonic_web::GrpcWebLayer::new())
                .service(BillingServiceServer::new(
                    BillingServiceHandler::with_authorizer(
                        billing_pg.clone(),
                        billing_auth.clone(),
                    ),
                ))
                .map_request(|request: axum::http::Request<axum::body::Body>| {
                    request.map(tonic::body::Body::new)
                });
            let chat_service = tower::ServiceBuilder::new()
                .layer(tonic_web::GrpcWebLayer::new())
                .service(ChatServiceServer::new(ChatServiceHandler::new()))
                .map_request(|request: axum::http::Request<axum::body::Body>| {
                    request.map(tonic::body::Body::new)
                });

            Router::new()
                .route_service("/tearleads.v2.AdminService/{*rest}", admin_service)
                .route_service("/tearleads.v2.BillingService/{*rest}", billing_service)
                .route_service("/tearleads.v2.ChatService/{*rest}", chat_service)
        }
    };

    Router::new()
        .route("/v2/ping", get(ping))
        .nest_service("/connect", build_connect_routes())
        .layer(cors_layer(origins))
        .layer(TraceLayer::new_for_http())
}

/// Returns a static Redis repository suitable for use when no real Redis
/// is available (e.g. local dev or when only Postgres is wired up).
pub fn admin_harness_static_redis() -> admin_harness::StaticRedisRepository {
    admin_harness::StaticRedisRepository
}

/// Builds the router with static fixture repositories (for tests / local dev).
pub fn app_with_origins(origins: &str) -> Router {
    let build_connect_routes = || {
        let admin_service = tower::ServiceBuilder::new()
            .layer(tonic_web::GrpcWebLayer::new())
            .service(AdminServiceServer::new(
                admin_harness::create_admin_handler(),
            ))
            .map_request(|request: axum::http::Request<axum::body::Body>| {
                request.map(tonic::body::Body::new)
            });
        let billing_service = tower::ServiceBuilder::new()
            .layer(tonic_web::GrpcWebLayer::new())
            .service(BillingServiceServer::new(
                admin_harness::create_billing_handler(),
            ))
            .map_request(|request: axum::http::Request<axum::body::Body>| {
                request.map(tonic::body::Body::new)
            });
        let chat_service = tower::ServiceBuilder::new()
            .layer(tonic_web::GrpcWebLayer::new())
            .service(ChatServiceServer::new(ChatServiceHandler::new()))
            .map_request(|request: axum::http::Request<axum::body::Body>| {
                request.map(tonic::body::Body::new)
            });

        Router::new()
            .route_service("/tearleads.v2.AdminService/{*rest}", admin_service)
            .route_service("/tearleads.v2.BillingService/{*rest}", billing_service)
            .route_service("/tearleads.v2.ChatService/{*rest}", chat_service)
    };

    Router::new()
        .route("/v2/ping", get(ping))
        .nest_service("/connect", build_connect_routes())
        .layer(cors_layer(origins))
        .layer(TraceLayer::new_for_http())
}

fn cors_layer(origins: &str) -> CorsLayer {
    if origins.is_empty() {
        return CorsLayer::permissive();
    }

    let parsed: Vec<_> = origins
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect();

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(parsed))
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any)
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use super::admin_harness::StaticPostgresRepository;
    use super::{admin_harness_static_redis, app_with_origins, app_with_repos};

    fn admin_tables_request(path: &str) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/grpc-web+proto")
            .header("x-grpc-web", "1")
            .header("authorization", "Bearer header.payload.signature")
            .body(Body::empty())
            .expect("request should build")
    }

    fn billing_request(path: &str) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/grpc-web+proto")
            .header("x-grpc-web", "1")
            .header("authorization", "Bearer header.payload.signature")
            .body(Body::empty())
            .expect("request should build")
    }

    fn chat_request(path: &str) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/grpc-web+proto")
            .header("x-grpc-web", "1")
            .header("authorization", "Bearer header.payload.signature")
            .body(Body::empty())
            .expect("request should build")
    }

    #[tokio::test]
    async fn admin_connect_route_is_mounted_by_default() {
        let response = app_with_origins("")
            .oneshot(admin_tables_request(
                "/connect/tearleads.v2.AdminService/GetTables",
            ))
            .await
            .expect("router should return a response");
        assert_ne!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn v1_admin_connect_alias_is_not_mounted() {
        let response = app_with_origins("")
            .oneshot(admin_tables_request(
                "/v1/connect/tearleads.v2.AdminService/GetTables",
            ))
            .await
            .expect("router should return a response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn app_with_repos_mounts_connect_routes() {
        let pg = StaticPostgresRepository;
        let rd = admin_harness_static_redis();
        let response = app_with_repos("", pg, rd, StaticPostgresRepository)
            .oneshot(admin_tables_request(
                "/connect/tearleads.v2.AdminService/GetTables",
            ))
            .await
            .expect("router should return a response");
        assert_ne!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn billing_connect_route_is_mounted_by_default() {
        let response = app_with_origins("")
            .oneshot(billing_request(
                "/connect/tearleads.v2.BillingService/GetOrganizationBilling",
            ))
            .await
            .expect("router should return a response");
        assert_ne!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn v1_billing_connect_alias_is_not_mounted() {
        let response = app_with_origins("")
            .oneshot(billing_request(
                "/v1/connect/tearleads.v2.BillingService/GetOrganizationBilling",
            ))
            .await
            .expect("router should return a response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn chat_connect_route_is_mounted_by_default() {
        let response = app_with_origins("")
            .oneshot(chat_request(
                "/connect/tearleads.v2.ChatService/PostCompletions",
            ))
            .await
            .expect("router should return a response");
        assert_ne!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn v1_chat_connect_alias_is_not_mounted() {
        let response = app_with_origins("")
            .oneshot(chat_request(
                "/v1/connect/tearleads.v2.ChatService/PostCompletions",
            ))
            .await
            .expect("router should return a response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}

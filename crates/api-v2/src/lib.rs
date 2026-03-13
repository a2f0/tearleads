//! API v2 router and handlers.

mod admin_auth;
mod admin_harness;
mod admin_service;
mod admin_service_common;
mod ai_service;
mod auth_service;
mod billing_auth;
mod billing_service;
mod chat_service;
mod mls_service;
mod notification_service;
mod ping;
/// Concrete Postgres gateway backed by `tokio-postgres` and `deadpool`.
mod postgres_gateway;
mod revenuecat_service;
mod upstream_connect;
mod vfs_service;
mod vfs_shares_service;

use axum::{Router, routing::get};
use tearleads_api_v2_contracts::tearleads::v2::{
    admin_service_server::AdminServiceServer, ai_service_server::AiServiceServer,
    auth_service_server::AuthServiceServer, billing_service_server::BillingServiceServer,
    chat_service_server::ChatServiceServer, mls_service_server::MlsServiceServer,
    notification_service_server::NotificationServiceServer,
    revenuecat_service_server::RevenuecatServiceServer, vfs_service_server::VfsServiceServer,
    vfs_shares_service_server::VfsSharesServiceServer,
};
use tearleads_data_access_traits::{
    PostgresAdminRepository, PostgresAiUsageRepository, PostgresAuthRepository,
    PostgresBillingRepository, RedisAdminRepository,
};
use tower::ServiceExt;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

pub use admin_auth::{
    AdminAccessContext, AdminAuthError, AdminAuthErrorKind, AdminOperation, AdminRequestAuthorizer,
};
pub use admin_service::AdminServiceHandler;
pub use ai_service::AiServiceHandler;
pub use auth_service::{AuthServiceConfig, AuthServiceHandler, RedisAuthSessionStore};
pub use billing_auth::{
    AuthorizationHeaderBillingAuthorizer, BillingAccessContext, BillingAuthError,
    BillingAuthErrorKind, BillingRequestAuthorizer, JwtSessionBillingAuthorizer,
};
pub use billing_service::BillingServiceHandler;
pub use chat_service::{
    ChatCompletionGateway, ChatServiceHandler, OpenRouterChatCompletionResult,
    ReqwestOpenRouterGateway,
};
pub use mls_service::MlsServiceHandler;
pub use notification_service::NotificationServiceHandler;
pub use ping::PingResponse;
use ping::ping;
pub use postgres_gateway::TokioPostgresGateway;
pub use revenuecat_service::RevenuecatServiceHandler;
pub use vfs_service::VfsServiceHandler;
pub use vfs_shares_service::VfsSharesServiceHandler;

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
    B: PostgresBillingRepository
        + PostgresAiUsageRepository
        + PostgresAuthRepository
        + Clone
        + Send
        + Sync
        + 'static,
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
    B: PostgresBillingRepository
        + PostgresAiUsageRepository
        + PostgresAuthRepository
        + Clone
        + Send
        + Sync
        + 'static,
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
            let ai_service = tower::ServiceBuilder::new()
                .layer(tonic_web::GrpcWebLayer::new())
                .service(AiServiceServer::new(AiServiceHandler::new(
                    billing_pg.clone(),
                )))
                .map_request(|request: axum::http::Request<axum::body::Body>| {
                    request.map(tonic::body::Body::new)
                });
            let auth_service = tower::ServiceBuilder::new()
                .layer(tonic_web::GrpcWebLayer::new())
                .service(AuthServiceServer::new(AuthServiceHandler::new(
                    billing_pg.clone(),
                )))
                .map_request(|request: axum::http::Request<axum::body::Body>| {
                    request.map(tonic::body::Body::new)
                });
            let mls_service = tower::ServiceBuilder::new()
                .layer(tonic_web::GrpcWebLayer::new())
                .service(MlsServiceServer::new(MlsServiceHandler::new()))
                .map_request(|request: axum::http::Request<axum::body::Body>| {
                    request.map(tonic::body::Body::new)
                });
            let notification_service = tower::ServiceBuilder::new()
                .layer(tonic_web::GrpcWebLayer::new())
                .service(NotificationServiceServer::new(
                    NotificationServiceHandler::new(),
                ))
                .map_request(|request: axum::http::Request<axum::body::Body>| {
                    request.map(tonic::body::Body::new)
                });
            let revenuecat_service = tower::ServiceBuilder::new()
                .layer(tonic_web::GrpcWebLayer::new())
                .service(RevenuecatServiceServer::new(RevenuecatServiceHandler::new()))
                .map_request(|request: axum::http::Request<axum::body::Body>| {
                    request.map(tonic::body::Body::new)
                });
            let vfs_service = tower::ServiceBuilder::new()
                .layer(tonic_web::GrpcWebLayer::new())
                .service(VfsServiceServer::new(VfsServiceHandler::new()))
                .map_request(|request: axum::http::Request<axum::body::Body>| {
                    request.map(tonic::body::Body::new)
                });
            let vfs_shares_service = tower::ServiceBuilder::new()
                .layer(tonic_web::GrpcWebLayer::new())
                .service(VfsSharesServiceServer::new(VfsSharesServiceHandler::new()))
                .map_request(|request: axum::http::Request<axum::body::Body>| {
                    request.map(tonic::body::Body::new)
                });

            Router::new()
                .route_service("/tearleads.v2.AdminService/{*rest}", admin_service)
                .route_service("/tearleads.v2.BillingService/{*rest}", billing_service)
                .route_service("/tearleads.v2.ChatService/{*rest}", chat_service)
                .route_service("/tearleads.v2.AiService/{*rest}", ai_service)
                .route_service("/tearleads.v2.AuthService/{*rest}", auth_service)
                .route_service("/tearleads.v2.MlsService/{*rest}", mls_service)
                .route_service(
                    "/tearleads.v2.NotificationService/{*rest}",
                    notification_service,
                )
                .route_service(
                    "/tearleads.v2.RevenuecatService/{*rest}",
                    revenuecat_service,
                )
                .route_service("/tearleads.v2.VfsService/{*rest}", vfs_service)
                .route_service("/tearleads.v2.VfsSharesService/{*rest}", vfs_shares_service)
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
        let ai_service = tower::ServiceBuilder::new()
            .layer(tonic_web::GrpcWebLayer::new())
            .service(AiServiceServer::new(AiServiceHandler::new(
                admin_harness::StaticPostgresRepository,
            )))
            .map_request(|request: axum::http::Request<axum::body::Body>| {
                request.map(tonic::body::Body::new)
            });
        let auth_service = tower::ServiceBuilder::new()
            .layer(tonic_web::GrpcWebLayer::new())
            .service(AuthServiceServer::new(AuthServiceHandler::new(
                admin_harness::StaticPostgresRepository,
            )))
            .map_request(|request: axum::http::Request<axum::body::Body>| {
                request.map(tonic::body::Body::new)
            });
        let mls_service = tower::ServiceBuilder::new()
            .layer(tonic_web::GrpcWebLayer::new())
            .service(MlsServiceServer::new(MlsServiceHandler::new()))
            .map_request(|request: axum::http::Request<axum::body::Body>| {
                request.map(tonic::body::Body::new)
            });
        let notification_service = tower::ServiceBuilder::new()
            .layer(tonic_web::GrpcWebLayer::new())
            .service(NotificationServiceServer::new(
                NotificationServiceHandler::new(),
            ))
            .map_request(|request: axum::http::Request<axum::body::Body>| {
                request.map(tonic::body::Body::new)
            });
        let revenuecat_service = tower::ServiceBuilder::new()
            .layer(tonic_web::GrpcWebLayer::new())
            .service(RevenuecatServiceServer::new(RevenuecatServiceHandler::new()))
            .map_request(|request: axum::http::Request<axum::body::Body>| {
                request.map(tonic::body::Body::new)
            });
        let vfs_service = tower::ServiceBuilder::new()
            .layer(tonic_web::GrpcWebLayer::new())
            .service(VfsServiceServer::new(VfsServiceHandler::new()))
            .map_request(|request: axum::http::Request<axum::body::Body>| {
                request.map(tonic::body::Body::new)
            });
        let vfs_shares_service = tower::ServiceBuilder::new()
            .layer(tonic_web::GrpcWebLayer::new())
            .service(VfsSharesServiceServer::new(VfsSharesServiceHandler::new()))
            .map_request(|request: axum::http::Request<axum::body::Body>| {
                request.map(tonic::body::Body::new)
            });

        Router::new()
            .route_service("/tearleads.v2.AdminService/{*rest}", admin_service)
            .route_service("/tearleads.v2.BillingService/{*rest}", billing_service)
            .route_service("/tearleads.v2.ChatService/{*rest}", chat_service)
            .route_service("/tearleads.v2.AiService/{*rest}", ai_service)
            .route_service("/tearleads.v2.AuthService/{*rest}", auth_service)
            .route_service("/tearleads.v2.MlsService/{*rest}", mls_service)
            .route_service(
                "/tearleads.v2.NotificationService/{*rest}",
                notification_service,
            )
            .route_service(
                "/tearleads.v2.RevenuecatService/{*rest}",
                revenuecat_service,
            )
            .route_service("/tearleads.v2.VfsService/{*rest}", vfs_service)
            .route_service("/tearleads.v2.VfsSharesService/{*rest}", vfs_shares_service)
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
mod lib_tests;

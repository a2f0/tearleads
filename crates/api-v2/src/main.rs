//! Binary entrypoint for the API v2 service.

use std::{env, net::SocketAddr};

use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

const DEFAULT_PORT: u16 = 5002;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    initialize_tracing();

    let origins = env::var("ALLOWED_ORIGINS").unwrap_or_default();
    let port = read_port();
    let address = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(address).await?;

    let app = build_app(&origins);

    tracing::info!("api-v2 listening on http://{address}");

    axum::serve(listener, app).await
}

fn build_app(origins: &str) -> axum::Router {
    use tearleads_api_v2::TokioPostgresGateway;
    use tearleads_data_access_postgres::PostgresAdminAdapter;

    match TokioPostgresGateway::from_env() {
        Some(gateway) => {
            tracing::info!("postgres gateway initialized from environment");
            let postgres_repo = PostgresAdminAdapter::new(gateway);
            let redis_repo = tearleads_api_v2::admin_harness_static_redis();
            tearleads_api_v2::app_with_repos(origins, postgres_repo, redis_repo)
        }
        None => {
            tracing::warn!("postgres pool initialization failed — using static fixture repositories");
            tearleads_api_v2::app_with_origins(origins)
        }
    }
}

fn read_port() -> u16 {
    env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT)
}

fn initialize_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::fmt().with_env_filter(filter).init();
}

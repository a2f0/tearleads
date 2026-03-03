//! Binary entrypoint for the API v2 service.

use std::{env, net::SocketAddr};

use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

const DEFAULT_PORT: u16 = 5002;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    initialize_tracing();

    let port = read_port();
    let address = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(address).await?;

    tracing::info!("api-v2 listening on http://{address}");

    axum::serve(listener, tearleads_api_v2::app()).await
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

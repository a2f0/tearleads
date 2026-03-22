use store::memory::MemoryStore;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();

    let addr = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "127.0.0.1:3000".to_string());

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    let local_addr = listener.local_addr()?;
    println!("listening on {local_addr}");

    let app = http_server::app(MemoryStore::new());
    axum::serve(listener, app)
        .await
        .map_err(std::io::Error::other)
}

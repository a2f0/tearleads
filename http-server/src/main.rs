use store::memory::MemoryStore;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();

    let addr = "127.0.0.1:3000";
    tracing::info!("listening on {addr}");
    http_server::run(MemoryStore::new(), addr).await
}

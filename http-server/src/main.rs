use store::memory::MemoryStore;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let addr = "127.0.0.1:3000";
    println!("listening on {addr}");
    http_server::run(MemoryStore::new(), addr).await
}

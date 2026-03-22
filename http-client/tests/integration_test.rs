use http_client::Client;
use protocol::Namespace;
use store::memory::MemoryStore;

async fn start_server() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}");

    let app = http_server::app(MemoryStore::new());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::task::yield_now().await;
    url
}

#[tokio::test]
async fn test_write_and_read() {
    let base_url = start_server().await;
    let client = Client::new(&base_url);

    client
        .write(&Namespace::Node, "doc1", "owner", "alice", b"hello world")
        .await
        .unwrap();

    let tuple = client
        .read(&Namespace::Node, "doc1", "owner", "alice")
        .await
        .unwrap()
        .expect("tuple should exist");

    assert_eq!(tuple.namespace, Namespace::Node);
    assert_eq!(tuple.object, "doc1");
    assert_eq!(tuple.relation, "owner");
    assert_eq!(tuple.subject, "alice");
    assert_eq!(tuple.payload, b"hello world");
}

#[tokio::test]
async fn test_read_not_found() {
    let base_url = start_server().await;
    let client = Client::new(&base_url);

    let result = client
        .read(&Namespace::Node, "doc1", "owner", "alice")
        .await
        .unwrap();

    assert!(result.is_none());
}

#[tokio::test]
async fn test_delete() {
    let base_url = start_server().await;
    let client = Client::new(&base_url);

    client
        .write(&Namespace::Node, "doc1", "owner", "alice", b"data")
        .await
        .unwrap();

    let deleted = client
        .delete(&Namespace::Node, "doc1", "owner", "alice")
        .await
        .unwrap();
    assert!(deleted);

    let result = client
        .read(&Namespace::Node, "doc1", "owner", "alice")
        .await
        .unwrap();
    assert!(result.is_none());
}

#[tokio::test]
async fn test_delete_not_found() {
    let base_url = start_server().await;
    let client = Client::new(&base_url);

    let deleted = client
        .delete(&Namespace::Node, "doc1", "owner", "alice")
        .await
        .unwrap();
    assert!(!deleted);
}

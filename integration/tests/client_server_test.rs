use client::Client;
use server::Server;
use transport::Transport;
use transport::tcp::{TcpListenerTransport, TcpTransport};

fn spawn_client(addr: String, msg: &'static [u8]) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let transport = TcpTransport::connect(&addr).expect("Failed to connect");
        let mut client = Client::new(transport);
        client.send(msg).expect("Failed to send");
    })
}

#[test]
fn test_client_sends_to_server() {
    let listener = TcpListenerTransport::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    let server = Server::new(listener);

    let handle = spawn_client(addr, b"hello from client");

    let mut conn = server.accept().unwrap();
    let msg = conn.recv().unwrap();
    assert_eq!(msg, b"hello from client");

    handle.join().unwrap();
}

#[test]
fn test_multiple_clients_to_server() {
    let listener = TcpListenerTransport::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    let server = Server::new(listener);

    let h1 = spawn_client(addr.clone(), b"from client 1");
    let h2 = spawn_client(addr.clone(), b"from client 2");

    let mut messages = Vec::new();
    for _ in 0..2 {
        let mut conn = server.accept().unwrap();
        let msg = conn.recv().unwrap();
        messages.push(String::from_utf8_lossy(&msg).into_owned());
    }

    h1.join().unwrap();
    h2.join().unwrap();

    messages.sort();
    assert_eq!(messages, vec!["from client 1", "from client 2"]);
}

#[test]
fn test_multiple_servers() {
    let listener1 = TcpListenerTransport::bind("127.0.0.1:0").unwrap();
    let listener2 = TcpListenerTransport::bind("127.0.0.1:0").unwrap();
    let addr1 = listener1.local_addr().unwrap().to_string();
    let addr2 = listener2.local_addr().unwrap().to_string();
    let server1 = Server::new(listener1);
    let server2 = Server::new(listener2);

    let h1 = spawn_client(addr1, b"to server 1");
    let h2 = spawn_client(addr2, b"to server 2");

    let mut conn1 = server1.accept().unwrap();
    let mut conn2 = server2.accept().unwrap();
    let msg1 = conn1.recv().unwrap();
    let msg2 = conn2.recv().unwrap();

    h1.join().unwrap();
    h2.join().unwrap();

    assert_eq!(msg1, b"to server 1");
    assert_eq!(msg2, b"to server 2");
}

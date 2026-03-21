use client::Client;
use server::Server;

fn spawn_client(addr: String, msg: &'static [u8]) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut client = Client::new(&addr).expect("Failed to connect");
        client.send(msg).expect("Failed to send");
    })
}

#[test]
fn test_client_sends_to_server() {
    let server = Server::bind("127.0.0.1:0").unwrap();
    let addr = server.local_addr().unwrap().to_string();

    let handle = spawn_client(addr, b"hello from client");

    let msg = server.accept_one().unwrap();
    assert_eq!(msg, "hello from client");

    handle.join().unwrap();
}

#[test]
fn test_multiple_clients_to_server() {
    let server = Server::bind("127.0.0.1:0").unwrap();
    let addr = server.local_addr().unwrap().to_string();

    let h1 = spawn_client(addr.clone(), b"from client 1");
    let h2 = spawn_client(addr.clone(), b"from client 2");

    let mut messages = Vec::new();
    for _ in 0..2 {
        messages.push(server.accept_one().unwrap());
    }

    h1.join().unwrap();
    h2.join().unwrap();

    messages.sort();
    assert_eq!(messages, vec!["from client 1", "from client 2"]);
}

#[test]
fn test_multiple_servers() {
    let server1 = Server::bind("127.0.0.1:0").unwrap();
    let server2 = Server::bind("127.0.0.1:0").unwrap();
    let addr1 = server1.local_addr().unwrap().to_string();
    let addr2 = server2.local_addr().unwrap().to_string();

    let h1 = spawn_client(addr1, b"to server 1");
    let h2 = spawn_client(addr2, b"to server 2");

    let msg1 = server1.accept_one().unwrap();
    let msg2 = server2.accept_one().unwrap();

    h1.join().unwrap();
    h2.join().unwrap();

    assert_eq!(msg1, "to server 1");
    assert_eq!(msg2, "to server 2");
}

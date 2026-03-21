use client::Client;
use server::Server;

#[test]
fn test_client_sends_to_server() {
    let server = Server::bind("127.0.0.1:0").unwrap();
    let addr = server.local_addr().unwrap().to_string();

    let handle = std::thread::spawn(move || {
        let mut client = Client::new(&addr).expect("Failed to connect");
        client.send(b"hello from client").expect("Failed to send");
    });

    let msg = server.accept_one().unwrap();
    assert_eq!(msg, "hello from client");

    handle.join().unwrap();
}

#[test]
fn test_multiple_clients_to_server() {
    let server = Server::bind("127.0.0.1:0").unwrap();
    let addr = server.local_addr().unwrap().to_string();

    let addr1 = addr.clone();
    let h1 = std::thread::spawn(move || {
        let mut client = Client::new(&addr1).expect("Failed to connect");
        client.send(b"from client 1").expect("Failed to send");
    });

    let addr2 = addr.clone();
    let h2 = std::thread::spawn(move || {
        let mut client = Client::new(&addr2).expect("Failed to connect");
        client.send(b"from client 2").expect("Failed to send");
    });

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

    let h1 = std::thread::spawn(move || {
        let mut client = Client::new(&addr1).expect("Failed to connect");
        client.send(b"to server 1").expect("Failed to send");
    });

    let h2 = std::thread::spawn(move || {
        let mut client = Client::new(&addr2).expect("Failed to connect");
        client.send(b"to server 2").expect("Failed to send");
    });

    let msg1 = server1.accept_one().unwrap();
    let msg2 = server2.accept_one().unwrap();

    h1.join().unwrap();
    h2.join().unwrap();

    assert_eq!(msg1, "to server 1");
    assert_eq!(msg2, "to server 2");
}

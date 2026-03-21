use transport::Transport;
use transport::tcp::{TcpListenerTransport, TcpTransport};

#[test]
fn test_server_receives_message() {
    let listener = TcpListenerTransport::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let server = server::Server::new(listener);

    let handle = std::thread::spawn(move || {
        let mut client = TcpTransport::connect(&addr.to_string()).unwrap();
        client.send(b"integration test").unwrap();
    });

    let mut conn = server.accept().unwrap();
    let msg = conn.recv().unwrap();
    assert_eq!(msg, b"integration test");

    handle.join().unwrap();
}

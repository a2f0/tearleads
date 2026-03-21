use transport::{Listener, Transport};
use transport::tcp::{TcpListenerTransport, TcpTransport};

#[test]
fn test_client_sends_message() {
    let listener = TcpListenerTransport::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();

    let handle = std::thread::spawn(move || {
        let transport = TcpTransport::connect(&addr).expect("Failed to connect");
        let mut client = client::Client::new(transport);
        client.send(b"integration test").expect("Failed to send in integration test");
    });

    let mut conn = listener.accept().unwrap();
    let msg = conn.recv().unwrap();
    assert_eq!(msg, b"integration test");

    handle.join().unwrap();
}

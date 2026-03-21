use std::io::Read;
use std::net::TcpListener;

#[test]
fn test_client_sends_message() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();

    let handle = std::thread::spawn(move || {
        let mut client = client::Client::new(&addr).expect("Failed to connect");
        client.send(b"integration test").expect("Failed to send in integration test");
    });

    let (mut stream, _) = listener.accept().unwrap();
    let mut buf = [0; protocol::MAX_MESSAGE_SIZE];
    let n = stream.read(&mut buf).unwrap();
    assert_eq!(&buf[..n], b"integration test");

    handle.join().unwrap();
}

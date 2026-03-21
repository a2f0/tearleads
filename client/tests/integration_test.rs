use std::io::Read;
use std::net::TcpListener;

#[test]
fn test_client_sends_message() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();

    let handle = std::thread::spawn(move || {
        client::send_message(&addr, b"integration test").unwrap();
    });

    let (mut stream, _) = listener.accept().unwrap();
    let mut buf = [0; 1024];
    let n = stream.read(&mut buf).unwrap();
    assert_eq!(&buf[..n], b"integration test");

    handle.join().unwrap();
}

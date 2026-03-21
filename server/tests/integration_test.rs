use std::io::Write;
use std::net::TcpStream;

#[test]
fn test_server_receives_message() {
    let server = server::Server::bind("127.0.0.1:0").unwrap();
    let addr = server.local_addr().unwrap();

    let mut client = TcpStream::connect(addr).unwrap();
    client.write_all(b"integration test").unwrap();
    drop(client);

    let msg = server.accept_one().unwrap();
    assert_eq!(msg, "integration test");
}

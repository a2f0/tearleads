use std::io::Read;
use std::net::TcpListener;

fn main() {
    let listener = TcpListener::bind("127.0.0.1:7878").unwrap();
    println!("Listening on 127.0.0.1:7878");

    for stream in listener.incoming() {
        let mut stream = stream.unwrap();
        println!("Connection established!");

        let mut buf = [0; 1024];
        let n = stream.read(&mut buf).unwrap();
        println!("Received: {}", String::from_utf8_lossy(&buf[..n]));
    }
}

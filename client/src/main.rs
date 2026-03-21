use std::io::Write;
use std::net::TcpStream;

fn main() {
    let mut stream = TcpStream::connect("127.0.0.1:7878").unwrap();
    stream.write_all(b"Hello from client!").unwrap();
    println!("Request sent to 127.0.0.1:7878");
}

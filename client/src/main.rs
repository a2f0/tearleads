fn main() {
    client::send_message("127.0.0.1:7878", b"Hello from client!").unwrap();
    println!("Request sent to 127.0.0.1:7878");
}

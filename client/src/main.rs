fn main() {
    client::send_message(protocol::DEFAULT_ADDR, b"Hello from client!").unwrap();
    println!("Request sent to {}", protocol::DEFAULT_ADDR);
}

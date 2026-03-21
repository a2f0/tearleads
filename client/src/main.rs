fn main() -> std::io::Result<()> {
    client::send_message(protocol::DEFAULT_ADDR, b"Hello from client!")?;
    println!("Request sent to {}", protocol::DEFAULT_ADDR);
    Ok(())
}

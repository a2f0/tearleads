fn main() -> std::io::Result<()> {
    let client = client::Client::new(protocol::DEFAULT_ADDR);
    client.send(b"Hello from client!")?;
    println!("Request sent to {}", protocol::DEFAULT_ADDR);
    Ok(())
}

use transport::tcp::TcpTransport;

fn main() -> std::io::Result<()> {
    let transport = TcpTransport::connect(protocol::DEFAULT_ADDR)?;
    let mut client = client::Client::new(transport);
    client.send(b"Hello from client!")?;
    println!("Request sent to {}", protocol::DEFAULT_ADDR);
    Ok(())
}

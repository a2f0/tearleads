fn main() -> std::io::Result<()> {
    let server = server::Server::bind(protocol::DEFAULT_ADDR)?;
    println!("Listening on {}", protocol::DEFAULT_ADDR);

    loop {
        match server.accept_one() {
            Ok(msg) => println!("Received: {msg}"),
            Err(e) => eprintln!("Error: {e}"),
        }
    }
}

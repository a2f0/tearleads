use transport::Transport;
use transport::tcp::TcpListenerTransport;

fn main() -> std::io::Result<()> {
    let listener = TcpListenerTransport::bind(protocol::DEFAULT_ADDR)?;
    let server = server::Server::new(listener);
    println!("Listening on {}", protocol::DEFAULT_ADDR);

    loop {
        match server.accept() {
            Ok(mut conn) => match conn.recv() {
                Ok(msg) => println!("Received: {}", String::from_utf8_lossy(&msg)),
                Err(e) => eprintln!("Error reading: {e}"),
            },
            Err(e) => eprintln!("Error accepting: {e}"),
        }
    }
}

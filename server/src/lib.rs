use transport::Listener;

pub struct Server<L: Listener> {
    listener: L,
}

impl<L: Listener> Server<L> {
    pub fn new(listener: L) -> Self {
        Server { listener }
    }

    pub fn accept(&self) -> std::io::Result<L::Conn> {
        self.listener.accept()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use transport::Transport;
    use transport::tcp::{TcpListenerTransport, TcpTransport};

    #[test]
    fn test_bind() {
        let listener = TcpListenerTransport::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        assert_eq!(addr.ip().to_string(), "127.0.0.1");
        let _server = Server::new(listener);
    }

    #[test]
    fn test_accept() {
        let listener = TcpListenerTransport::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = Server::new(listener);

        let handle = std::thread::spawn(move || {
            let mut client = TcpTransport::connect(&addr.to_string()).unwrap();
            client.send(b"test message").unwrap();
        });

        let mut conn = server.accept().unwrap();
        let msg = conn.recv().unwrap();
        assert_eq!(msg, b"test message");

        handle.join().unwrap();
    }
}

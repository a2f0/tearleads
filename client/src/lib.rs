use transport::Transport;

pub struct Client<T: Transport> {
    transport: T,
}

impl<T: Transport> Client<T> {
    pub fn new(transport: T) -> Self {
        Client { transport }
    }

    pub fn send(&mut self, msg: &[u8]) -> std::io::Result<()> {
        self.transport.send(msg)
    }

    pub fn recv(&mut self) -> std::io::Result<Vec<u8>> {
        self.transport.recv()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use transport::Listener;
    use transport::tcp::{TcpListenerTransport, TcpTransport};

    #[test]
    fn test_send() {
        let listener = TcpListenerTransport::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();

        let handle = std::thread::spawn(move || {
            let transport = TcpTransport::connect(&addr).unwrap();
            let mut client = Client::new(transport);
            client.send(b"hello").expect("Failed to send message in test");
        });

        let mut conn = listener.accept().unwrap();
        let msg = conn.recv().unwrap();
        assert_eq!(msg, b"hello");

        handle.join().unwrap();
    }

    #[test]
    fn test_send_connection_refused() {
        let result = TcpTransport::connect("127.0.0.1:1");
        assert!(result.is_err());
    }

    #[test]
    fn test_multiple_clients() {
        let listener = TcpListenerTransport::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();

        let addr1 = addr.clone();
        let handle1 = std::thread::spawn(move || {
            let transport = TcpTransport::connect(&addr1).unwrap();
            let mut client = Client::new(transport);
            client.send(b"from client 1").expect("client1 failed");
        });
        let addr2 = addr.clone();
        let handle2 = std::thread::spawn(move || {
            let transport = TcpTransport::connect(&addr2).unwrap();
            let mut client = Client::new(transport);
            client.send(b"from client 2").expect("client2 failed");
        });

        let mut messages = Vec::new();
        for _ in 0..2 {
            let mut conn = listener.accept().unwrap();
            let msg = conn.recv().unwrap();
            messages.push(String::from_utf8_lossy(&msg).into_owned());
        }

        handle1.join().unwrap();
        handle2.join().unwrap();

        messages.sort();
        assert_eq!(messages, vec!["from client 1", "from client 2"]);
    }
}

use std::io::Write;
use std::net::TcpStream;

pub struct Client {
    stream: TcpStream,
}

impl Client {
    pub fn new(addr: &str) -> std::io::Result<Self> {
        let stream = TcpStream::connect(addr)?;
        Ok(Client { stream })
    }

    pub fn send(&mut self, msg: &[u8]) -> std::io::Result<()> {
        self.stream.write_all(msg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;

    #[test]
    fn test_send() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();

        let handle = std::thread::spawn(move || {
            let mut client = Client::new(&addr).expect("Failed to connect");
            client.send(b"hello").expect("Failed to send message in test");
        });

        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = [0; protocol::MAX_MESSAGE_SIZE];
        let n = stream.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"hello");

        handle.join().unwrap();
    }

    #[test]
    fn test_send_connection_refused() {
        let result = Client::new("127.0.0.1:1");
        assert!(result.is_err());
    }

    #[test]
    fn test_multiple_clients() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();

        let addr1 = addr.clone();
        let handle1 = std::thread::spawn(move || {
            let mut client = Client::new(&addr1).expect("client1 connect failed");
            client.send(b"from client 1").expect("client1 failed");
        });
        let addr2 = addr.clone();
        let handle2 = std::thread::spawn(move || {
            let mut client = Client::new(&addr2).expect("client2 connect failed");
            client.send(b"from client 2").expect("client2 failed");
        });

        let mut messages = Vec::new();
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0; protocol::MAX_MESSAGE_SIZE];
            let n = stream.read(&mut buf).unwrap();
            messages.push(String::from_utf8_lossy(&buf[..n]).into_owned());
        }

        handle1.join().unwrap();
        handle2.join().unwrap();

        messages.sort();
        assert_eq!(messages, vec!["from client 1", "from client 2"]);
    }
}

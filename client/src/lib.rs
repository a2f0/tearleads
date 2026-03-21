use std::io::Write;
use std::net::TcpStream;

pub struct Client {
    addr: String,
}

impl Client {
    pub fn new(addr: &str) -> Self {
        Client {
            addr: addr.to_string(),
        }
    }

    pub fn send(&self, msg: &[u8]) -> std::io::Result<()> {
        let mut stream = TcpStream::connect(&self.addr)?;
        stream.write_all(msg)?;
        Ok(())
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

        let client = Client::new(&addr);
        let handle = std::thread::spawn(move || {
            client.send(b"hello").expect("Failed to send message in test");
        });

        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = [0; 1024];
        let n = stream.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"hello");

        handle.join().unwrap();
    }

    #[test]
    fn test_send_connection_refused() {
        let client = Client::new("127.0.0.1:1");
        let result = client.send(b"hello");
        assert!(result.is_err());
    }

    #[test]
    fn test_multiple_clients() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();

        let client1 = Client::new(&addr);
        let client2 = Client::new(&addr);

        let handle1 = std::thread::spawn(move || {
            client1.send(b"from client 1").expect("client1 failed");
        });
        let handle2 = std::thread::spawn(move || {
            client2.send(b"from client 2").expect("client2 failed");
        });

        let mut messages = Vec::new();
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0; 1024];
            let n = stream.read(&mut buf).unwrap();
            messages.push(String::from_utf8_lossy(&buf[..n]).into_owned());
        }

        handle1.join().unwrap();
        handle2.join().unwrap();

        messages.sort();
        assert_eq!(messages, vec!["from client 1", "from client 2"]);
    }
}

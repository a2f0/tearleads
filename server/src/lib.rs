use std::io::Read;
use std::net::TcpListener;

pub struct Server {
    pub listener: TcpListener,
}

impl Server {
    pub fn bind(addr: &str) -> std::io::Result<Self> {
        let listener = TcpListener::bind(addr)?;
        Ok(Server { listener })
    }

    pub fn accept_one(&self) -> std::io::Result<String> {
        let (mut stream, _) = self.listener.accept()?;
        let mut buf = [0; 1024];
        let n = stream.read(&mut buf)?;
        Ok(String::from_utf8_lossy(&buf[..n]).into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpStream;

    #[test]
    fn test_bind() {
        let server = Server::bind("127.0.0.1:0").unwrap();
        let addr = server.listener.local_addr().unwrap();
        assert_eq!(addr.ip().to_string(), "127.0.0.1");
    }

    #[test]
    fn test_accept_one() {
        let server = Server::bind("127.0.0.1:0").unwrap();
        let addr = server.listener.local_addr().unwrap();

        let mut client = TcpStream::connect(addr).unwrap();
        client.write_all(b"test message").unwrap();
        drop(client);

        let msg = server.accept_one().unwrap();
        assert_eq!(msg, "test message");
    }
}

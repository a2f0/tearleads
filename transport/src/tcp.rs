use crate::{Listener, Transport};
use std::io::{self, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};

pub struct TcpTransport {
    stream: TcpStream,
}

impl TcpTransport {
    pub fn connect(addr: &str) -> io::Result<Self> {
        let stream = TcpStream::connect(addr)?;
        Ok(TcpTransport { stream })
    }

    fn from_stream(stream: TcpStream) -> Self {
        TcpTransport { stream }
    }
}

impl Transport for TcpTransport {
    fn send(&mut self, msg: &[u8]) -> io::Result<()> {
        let len = u32::try_from(msg.len())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "message too large"))?;
        self.stream.write_all(&len.to_be_bytes())?;
        self.stream.write_all(msg)?;
        self.stream.flush()
    }

    fn recv(&mut self) -> io::Result<Vec<u8>> {
        let mut len_buf = [0u8; 4];
        self.stream.read_exact(&mut len_buf)?;
        let len = u32::from_be_bytes(len_buf) as usize;
        const MAX_MESSAGE_SIZE: usize = 1_024;
        if len > MAX_MESSAGE_SIZE {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "message length exceeds maximum size",
            ));
        }
        let mut buf = vec![0u8; len];
        self.stream.read_exact(&mut buf)?;
        Ok(buf)
    }
}

pub struct TcpListenerTransport {
    listener: TcpListener,
}

impl TcpListenerTransport {
    pub fn bind(addr: &str) -> io::Result<Self> {
        let listener = TcpListener::bind(addr)?;
        Ok(TcpListenerTransport { listener })
    }

    pub fn local_addr(&self) -> io::Result<SocketAddr> {
        self.listener.local_addr()
    }
}

impl Listener for TcpListenerTransport {
    type Conn = TcpTransport;

    fn accept(&self) -> io::Result<TcpTransport> {
        let (stream, _) = self.listener.accept()?;
        Ok(TcpTransport::from_stream(stream))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_send_recv() {
        let listener = TcpListenerTransport::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();

        let handle = std::thread::spawn(move || {
            let mut client = TcpTransport::connect(&addr).unwrap();
            client.send(b"hello").unwrap();
        });

        let mut conn = listener.accept().unwrap();
        let msg = conn.recv().unwrap();
        assert_eq!(msg, b"hello");

        handle.join().unwrap();
    }

    #[test]
    fn test_multiple_messages() {
        let listener = TcpListenerTransport::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();

        let handle = std::thread::spawn(move || {
            let mut client = TcpTransport::connect(&addr).unwrap();
            client.send(b"first").unwrap();
            client.send(b"second").unwrap();
            client.send(b"third").unwrap();
        });

        let mut conn = listener.accept().unwrap();
        assert_eq!(conn.recv().unwrap(), b"first");
        assert_eq!(conn.recv().unwrap(), b"second");
        assert_eq!(conn.recv().unwrap(), b"third");

        handle.join().unwrap();
    }

    #[test]
    fn test_bidirectional() {
        let listener = TcpListenerTransport::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();

        let handle = std::thread::spawn(move || {
            let mut client = TcpTransport::connect(&addr).unwrap();
            client.send(b"ping").unwrap();
            let reply = client.recv().unwrap();
            assert_eq!(reply, b"pong");
        });

        let mut conn = listener.accept().unwrap();
        let msg = conn.recv().unwrap();
        assert_eq!(msg, b"ping");
        conn.send(b"pong").unwrap();

        handle.join().unwrap();
    }
}

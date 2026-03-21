use std::io::Write;
use std::net::TcpStream;

pub fn send_message(addr: &str, msg: &[u8]) -> std::io::Result<()> {
    let mut stream = TcpStream::connect(addr)?;
    stream.write_all(msg)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;

    #[test]
    fn test_send_message() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();

        let handle = std::thread::spawn(move || {
            send_message(&addr, b"hello").unwrap();
        });

        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = [0; 1024];
        let n = stream.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"hello");

        handle.join().unwrap();
    }

    #[test]
    fn test_send_message_connection_refused() {
        let result = send_message("127.0.0.1:1", b"hello");
        assert!(result.is_err());
    }
}

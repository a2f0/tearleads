pub mod tcp;

use std::io;

pub trait Transport {
    fn send(&mut self, msg: &[u8]) -> io::Result<()>;
    fn recv(&mut self) -> io::Result<Vec<u8>>;
}

pub trait Listener {
    type Conn: Transport;

    fn accept(&self) -> io::Result<Self::Conn>;
}

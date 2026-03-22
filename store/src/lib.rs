pub mod memory;

use protocol::Namespace;
use std::io;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tuple {
    pub namespace: Namespace,
    pub object: String,
    pub relation: String,
    pub subject: String,
    pub payload: Vec<u8>,
}

pub trait Store {
    fn write(&mut self, tuple: Tuple) -> io::Result<()>;
    fn read(
        &self,
        namespace: &Namespace,
        object: &str,
        relation: &str,
        subject: &str,
    ) -> io::Result<Option<&Tuple>>;
    fn delete(
        &mut self,
        namespace: &Namespace,
        object: &str,
        relation: &str,
        subject: &str,
    ) -> io::Result<bool>;
}

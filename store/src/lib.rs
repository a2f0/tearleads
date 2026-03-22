pub mod memory;

use protocol::Namespace;
use serde::{Deserialize, Serialize};
use std::io;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tuple {
    pub namespace: Namespace,
    pub object: String,
    pub relation: String,
    pub subject: String,
    pub payload: Vec<u8>,
}

pub trait Store {
    fn write(&self, tuple: Tuple) -> io::Result<()>;
    fn read(
        &self,
        namespace: &Namespace,
        object: &str,
        relation: &str,
        subject: &str,
    ) -> io::Result<Option<Tuple>>;
    fn delete(
        &self,
        namespace: &Namespace,
        object: &str,
        relation: &str,
        subject: &str,
    ) -> io::Result<bool>;
}

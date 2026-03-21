pub const DEFAULT_ADDR: &str = "127.0.0.1:7878";
pub const MAX_MESSAGE_SIZE: usize = 1024;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Namespace {
    Node,
    Edge,
}

impl std::fmt::Display for Namespace {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Namespace::Node => write!(f, "node"),
            Namespace::Edge => write!(f, "edge"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_addr_is_valid() {
        let addr: std::net::SocketAddr = DEFAULT_ADDR.parse().unwrap();
        assert_eq!(addr.port(), 7878);
    }

    #[test]
    fn test_namespace_display() {
        assert_eq!(Namespace::Node.to_string(), "node");
        assert_eq!(Namespace::Edge.to_string(), "edge");
    }
}

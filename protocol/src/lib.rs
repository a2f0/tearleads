pub const DEFAULT_ADDR: &str = "127.0.0.1:7878";
pub const MAX_MESSAGE_SIZE: usize = 1024;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_addr_is_valid() {
        let addr: std::net::SocketAddr = DEFAULT_ADDR.parse().unwrap();
        assert_eq!(addr.port(), 7878);
    }
}

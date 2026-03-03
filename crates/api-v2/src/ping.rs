use axum::Json;
use serde::Serialize;

/// Response body for the ping endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PingResponse {
    /// Service health status.
    pub status: &'static str,
    /// Service identifier.
    pub service: &'static str,
    /// Crate version.
    pub version: &'static str,
}

/// Builds the static ping payload.
pub fn ping_payload() -> PingResponse {
    PingResponse {
        status: "ok",
        service: "api-v2",
        version: env!("CARGO_PKG_VERSION"),
    }
}

/// Handles GET ping requests.
pub async fn ping() -> Json<PingResponse> {
    Json(ping_payload())
}

#[cfg(test)]
mod tests {
    use super::{PingResponse, ping_payload};

    #[test]
    fn ping_payload_matches_contract() {
        let payload = ping_payload();

        assert_eq!(
            payload,
            PingResponse {
                status: "ok",
                service: "api-v2",
                version: env!("CARGO_PKG_VERSION")
            }
        );
    }
}

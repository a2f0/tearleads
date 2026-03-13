//! Shared upstream Connect/gRPC client wiring for delegated v2 service handlers.

use std::env;

use tonic::{
    Status,
    transport::{Channel, Endpoint},
};

const CONNECT_UPSTREAM_URL_ENV_KEY: &str = "API_V2_CONNECT_UPSTREAM_URL";
const DEFAULT_CONNECT_UPSTREAM_URL: &str = "http://api:5001/v1/connect";

/// Shared upstream endpoint factory for delegated service handlers.
#[derive(Debug, Clone)]
pub struct UpstreamConnectClientFactory {
    endpoint: Option<Endpoint>,
    config_error: Option<String>,
}

impl UpstreamConnectClientFactory {
    /// Builds an endpoint factory from `API_V2_CONNECT_UPSTREAM_URL`.
    pub fn from_env() -> Self {
        let upstream_connect_url = env::var(CONNECT_UPSTREAM_URL_ENV_KEY)
            .unwrap_or_else(|_| DEFAULT_CONNECT_UPSTREAM_URL.to_string());
        match Endpoint::from_shared(upstream_connect_url.clone()) {
            Ok(endpoint) => Self {
                endpoint: Some(endpoint),
                config_error: None,
            },
            Err(error) => Self {
                endpoint: None,
                config_error: Some(format!(
                    "invalid {CONNECT_UPSTREAM_URL_ENV_KEY} value {upstream_connect_url}: {error}"
                )),
            },
        }
    }

    /// Creates a lazy tonic transport channel for one RPC call.
    pub fn channel(&self) -> Result<Channel, Status> {
        if let Some(config_error) = self.config_error.as_ref() {
            return Err(Status::internal(config_error.clone()));
        }

        let Some(endpoint) = self.endpoint.as_ref() else {
            return Err(Status::internal(
                "upstream connect endpoint is not configured",
            ));
        };

        Ok(endpoint.clone().connect_lazy())
    }
}

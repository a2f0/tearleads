//! Shared upstream Connect/gRPC client wiring for delegated v2 service handlers.

use std::env;

use tonic::{
    Status,
    transport::{Channel, Endpoint},
};

const CONNECT_UPSTREAM_URL_ENV_KEY: &str = "API_V2_CONNECT_UPSTREAM_URL";
const DEFAULT_CONNECT_UPSTREAM_URL: &str = "http://api:5001/connect";

/// Shared upstream endpoint factory for delegated service handlers.
#[derive(Debug, Clone)]
pub struct UpstreamConnectClientFactory {
    endpoint: Option<Endpoint>,
    config_error: Option<String>,
}

impl UpstreamConnectClientFactory {
    pub(crate) fn from_url(upstream_connect_url: String) -> Self {
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

    /// Builds an endpoint factory from `API_V2_CONNECT_UPSTREAM_URL`.
    pub fn from_env() -> Self {
        let upstream_connect_url = env::var(CONNECT_UPSTREAM_URL_ENV_KEY)
            .unwrap_or_else(|_| DEFAULT_CONNECT_UPSTREAM_URL.to_string());
        Self::from_url(upstream_connect_url)
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

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use tonic::Code;

    use super::UpstreamConnectClientFactory;

    #[test]
    fn from_url_accepts_valid_http_url() {
        let factory = UpstreamConnectClientFactory::from_url("http://127.0.0.1:5001".to_string());
        assert!(factory.endpoint.is_some());
        assert!(factory.config_error.is_none());
    }

    #[test]
    fn from_url_rejects_invalid_url() {
        let factory =
            UpstreamConnectClientFactory::from_url("not a valid endpoint url".to_string());
        assert!(factory.endpoint.is_none());
        assert!(
            factory
                .config_error
                .as_deref()
                .unwrap_or_default()
                .contains("API_V2_CONNECT_UPSTREAM_URL")
        );
    }

    #[test]
    fn channel_fails_when_config_error_is_set() {
        let factory = UpstreamConnectClientFactory {
            endpoint: None,
            config_error: Some("invalid endpoint".to_string()),
        };
        let status = factory.channel().expect_err("channel should fail");
        assert_eq!(status.code(), Code::Internal);
        assert_eq!(status.message(), "invalid endpoint");
    }

    #[test]
    fn channel_fails_when_endpoint_missing() {
        let factory = UpstreamConnectClientFactory {
            endpoint: None,
            config_error: None,
        };
        let status = factory.channel().expect_err("channel should fail");
        assert_eq!(status.code(), Code::Internal);
        assert_eq!(
            status.message(),
            "upstream connect endpoint is not configured"
        );
    }

    #[tokio::test]
    async fn channel_succeeds_when_endpoint_exists() {
        let factory = UpstreamConnectClientFactory::from_url("http://127.0.0.1:5001".to_string());
        factory
            .channel()
            .expect("valid endpoint should produce lazy channel");
    }
}

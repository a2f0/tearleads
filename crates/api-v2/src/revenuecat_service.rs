//! Native-mounted Revenuecat service handler delegating to upstream RPC implementation.

use tearleads_api_v2_contracts::tearleads::v2::{
    HandleWebhookRequest, HandleWebhookResponse,
    revenuecat_service_client::RevenuecatServiceClient,
    revenuecat_service_server::RevenuecatService,
};
use tonic::{Request, Response, Status, transport::Channel};

use crate::upstream_connect::UpstreamConnectClientFactory;

/// Delegating `tearleads.v2.RevenuecatService` implementation.
#[derive(Clone)]
pub struct RevenuecatServiceHandler {
    upstream: UpstreamConnectClientFactory,
}

impl RevenuecatServiceHandler {
    /// Creates a handler using runtime upstream endpoint config.
    pub fn new() -> Self {
        Self::with_upstream(UpstreamConnectClientFactory::from_env())
    }

    /// Creates a handler from explicit upstream endpoint factory.
    pub fn with_upstream(upstream: UpstreamConnectClientFactory) -> Self {
        Self { upstream }
    }

    fn client(&self) -> Result<RevenuecatServiceClient<Channel>, Status> {
        Ok(RevenuecatServiceClient::new(self.upstream.channel()?))
    }
}

impl Default for RevenuecatServiceHandler {
    fn default() -> Self {
        Self::new()
    }
}

#[tonic::async_trait]
impl RevenuecatService for RevenuecatServiceHandler {
    async fn handle_webhook(
        &self,
        request: Request<HandleWebhookRequest>,
    ) -> Result<Response<HandleWebhookResponse>, Status> {
        let mut client = self.client()?;
        client.handle_webhook(request).await
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use tearleads_api_v2_contracts::tearleads::v2::revenuecat_service_server::RevenuecatService;
    use tonic::{Code, Request};

    use super::RevenuecatServiceHandler;
    use crate::upstream_connect::UpstreamConnectClientFactory;

    #[tokio::test]
    async fn handle_webhook_fails_fast_with_invalid_upstream_config() {
        let handler = RevenuecatServiceHandler::with_upstream(
            UpstreamConnectClientFactory::from_url("not-a-valid-upstream-url".to_string()),
        );
        let status = handler
            .handle_webhook(Request::new(Default::default()))
            .await
            .expect_err("invalid upstream config should fail");
        assert!(matches!(status.code(), Code::Internal | Code::Unknown));
    }

    #[test]
    fn constructors_and_default_are_usable() {
        let _ = RevenuecatServiceHandler::new();
        let _ = RevenuecatServiceHandler::default();
    }
}

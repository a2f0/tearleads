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

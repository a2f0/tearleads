//! Native-mounted Notification service handler delegating to upstream RPC implementation.

use tearleads_api_v2_contracts::tearleads::v2::{
    SubscribeRequest, SubscribeResponse, notification_service_client::NotificationServiceClient,
    notification_service_server::NotificationService,
};
use tonic::{Request, Response, Status, codec::Streaming, transport::Channel};

use crate::upstream_connect::UpstreamConnectClientFactory;

/// Delegating `tearleads.v2.NotificationService` implementation.
#[derive(Clone)]
pub struct NotificationServiceHandler {
    upstream: UpstreamConnectClientFactory,
}

impl NotificationServiceHandler {
    /// Creates a handler using runtime upstream endpoint config.
    pub fn new() -> Self {
        Self::with_upstream(UpstreamConnectClientFactory::from_env())
    }

    /// Creates a handler from explicit upstream endpoint factory.
    pub fn with_upstream(upstream: UpstreamConnectClientFactory) -> Self {
        Self { upstream }
    }

    fn client(&self) -> Result<NotificationServiceClient<Channel>, Status> {
        Ok(NotificationServiceClient::new(self.upstream.channel()?))
    }
}

#[tonic::async_trait]
impl NotificationService for NotificationServiceHandler {
    type SubscribeStream = Streaming<SubscribeResponse>;

    async fn subscribe(
        &self,
        request: Request<SubscribeRequest>,
    ) -> Result<Response<Self::SubscribeStream>, Status> {
        let mut client = self.client()?;
        client.subscribe(request).await
    }
}

//! Native-mounted VFS shares service handler delegating to upstream RPC implementation.

use tearleads_api_v2_contracts::tearleads::v2::{
    self, vfs_shares_service_client::VfsSharesServiceClient,
    vfs_shares_service_server::VfsSharesService,
};
use tonic::{Request, Response, Status, transport::Channel};

use crate::upstream_connect::UpstreamConnectClientFactory;

/// Delegating `tearleads.v2.VfsSharesService` implementation.
#[derive(Clone)]
pub struct VfsSharesServiceHandler {
    upstream: UpstreamConnectClientFactory,
}

impl VfsSharesServiceHandler {
    /// Creates a handler using runtime upstream endpoint config.
    pub fn new() -> Self {
        Self::with_upstream(UpstreamConnectClientFactory::from_env())
    }

    /// Creates a handler from explicit upstream endpoint factory.
    pub fn with_upstream(upstream: UpstreamConnectClientFactory) -> Self {
        Self { upstream }
    }

    fn client(&self) -> Result<VfsSharesServiceClient<Channel>, Status> {
        Ok(VfsSharesServiceClient::new(self.upstream.channel()?))
    }
}

impl Default for VfsSharesServiceHandler {
    fn default() -> Self {
        Self::new()
    }
}

macro_rules! forward_unary {
    ($self:ident, $request:ident, $method:ident) => {{
        let mut client = $self.client()?;
        client.$method($request).await
    }};
}

#[tonic::async_trait]
impl VfsSharesService for VfsSharesServiceHandler {
    async fn get_item_shares(
        &self,
        request: Request<v2::VfsSharesGetItemSharesRequest>,
    ) -> Result<Response<v2::VfsSharesGetItemSharesResponse>, Status> {
        forward_unary!(self, request, get_item_shares)
    }

    async fn create_share(
        &self,
        request: Request<v2::VfsSharesCreateShareRequest>,
    ) -> Result<Response<v2::VfsSharesCreateShareResponse>, Status> {
        forward_unary!(self, request, create_share)
    }

    async fn update_share(
        &self,
        request: Request<v2::VfsSharesUpdateShareRequest>,
    ) -> Result<Response<v2::VfsSharesUpdateShareResponse>, Status> {
        forward_unary!(self, request, update_share)
    }

    async fn delete_share(
        &self,
        request: Request<v2::VfsSharesDeleteShareRequest>,
    ) -> Result<Response<v2::VfsSharesDeleteShareResponse>, Status> {
        forward_unary!(self, request, delete_share)
    }

    async fn create_org_share(
        &self,
        request: Request<v2::VfsSharesCreateOrgShareRequest>,
    ) -> Result<Response<v2::VfsSharesCreateOrgShareResponse>, Status> {
        forward_unary!(self, request, create_org_share)
    }

    async fn delete_org_share(
        &self,
        request: Request<v2::VfsSharesDeleteOrgShareRequest>,
    ) -> Result<Response<v2::VfsSharesDeleteOrgShareResponse>, Status> {
        forward_unary!(self, request, delete_org_share)
    }

    async fn search_share_targets(
        &self,
        request: Request<v2::VfsSharesSearchShareTargetsRequest>,
    ) -> Result<Response<v2::VfsSharesSearchShareTargetsResponse>, Status> {
        forward_unary!(self, request, search_share_targets)
    }

    async fn get_share_policy_preview(
        &self,
        request: Request<v2::VfsSharesGetSharePolicyPreviewRequest>,
    ) -> Result<Response<v2::VfsSharesGetSharePolicyPreviewResponse>, Status> {
        forward_unary!(self, request, get_share_policy_preview)
    }
}

#[cfg(test)]
mod tests {
    use tearleads_api_v2_contracts::tearleads::v2::vfs_shares_service_server::VfsSharesService;
    use tonic::{Code, Request};

    use super::VfsSharesServiceHandler;
    use crate::upstream_connect::UpstreamConnectClientFactory;

    fn invalid_handler() -> VfsSharesServiceHandler {
        VfsSharesServiceHandler::with_upstream(UpstreamConnectClientFactory::from_url(
            "not-a-valid-upstream-url".to_string(),
        ))
    }

    async fn assert_internal<T: std::fmt::Debug>(
        result: Result<tonic::Response<T>, tonic::Status>,
    ) {
        let status = result.expect_err("invalid upstream config should fail");
        assert!(matches!(status.code(), Code::Internal | Code::Unknown));
    }

    #[tokio::test]
    async fn delegated_methods_fail_fast_with_invalid_upstream_config() {
        let handler = invalid_handler();

        assert_internal(
            handler
                .get_item_shares(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(handler.create_share(Request::new(Default::default())).await).await;
        assert_internal(handler.update_share(Request::new(Default::default())).await).await;
        assert_internal(handler.delete_share(Request::new(Default::default())).await).await;
        assert_internal(
            handler
                .create_org_share(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(
            handler
                .delete_org_share(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(
            handler
                .search_share_targets(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(
            handler
                .get_share_policy_preview(Request::new(Default::default()))
                .await,
        )
        .await;
    }

    #[test]
    fn constructors_and_default_are_usable() {
        let _ = VfsSharesServiceHandler::new();
        let _ = VfsSharesServiceHandler::default();
    }
}

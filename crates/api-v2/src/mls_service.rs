//! Native-mounted MLS service handler delegating to upstream RPC implementation.

use tearleads_api_v2_contracts::tearleads::v2::{
    self, mls_service_client::MlsServiceClient, mls_service_server::MlsService,
};
use tonic::{Request, Response, Status, transport::Channel};

use crate::upstream_connect::UpstreamConnectClientFactory;

/// Delegating `tearleads.v2.MlsService` implementation.
#[derive(Clone)]
pub struct MlsServiceHandler {
    upstream: UpstreamConnectClientFactory,
}

impl MlsServiceHandler {
    /// Creates a handler using runtime upstream endpoint config.
    pub fn new() -> Self {
        Self::with_upstream(UpstreamConnectClientFactory::from_env())
    }

    /// Creates a handler from explicit upstream endpoint factory.
    pub fn with_upstream(upstream: UpstreamConnectClientFactory) -> Self {
        Self { upstream }
    }

    fn client(&self) -> Result<MlsServiceClient<Channel>, Status> {
        Ok(MlsServiceClient::new(self.upstream.channel()?))
    }
}

impl Default for MlsServiceHandler {
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
impl MlsService for MlsServiceHandler {
    async fn upload_key_packages(
        &self,
        request: Request<v2::MlsUploadKeyPackagesRequest>,
    ) -> Result<Response<v2::MlsUploadKeyPackagesResponse>, Status> {
        forward_unary!(self, request, upload_key_packages)
    }

    async fn get_my_key_packages(
        &self,
        request: Request<v2::MlsGetMyKeyPackagesRequest>,
    ) -> Result<Response<v2::MlsGetMyKeyPackagesResponse>, Status> {
        forward_unary!(self, request, get_my_key_packages)
    }

    async fn get_user_key_packages(
        &self,
        request: Request<v2::MlsGetUserKeyPackagesRequest>,
    ) -> Result<Response<v2::MlsGetUserKeyPackagesResponse>, Status> {
        forward_unary!(self, request, get_user_key_packages)
    }

    async fn delete_key_package(
        &self,
        request: Request<v2::MlsDeleteKeyPackageRequest>,
    ) -> Result<Response<v2::MlsDeleteKeyPackageResponse>, Status> {
        forward_unary!(self, request, delete_key_package)
    }

    async fn create_group(
        &self,
        request: Request<v2::MlsCreateGroupRequest>,
    ) -> Result<Response<v2::MlsCreateGroupResponse>, Status> {
        forward_unary!(self, request, create_group)
    }

    async fn list_groups(
        &self,
        request: Request<v2::MlsListGroupsRequest>,
    ) -> Result<Response<v2::MlsListGroupsResponse>, Status> {
        forward_unary!(self, request, list_groups)
    }

    async fn get_group(
        &self,
        request: Request<v2::MlsGetGroupRequest>,
    ) -> Result<Response<v2::MlsGetGroupResponse>, Status> {
        forward_unary!(self, request, get_group)
    }

    async fn update_group(
        &self,
        request: Request<v2::MlsUpdateGroupRequest>,
    ) -> Result<Response<v2::MlsUpdateGroupResponse>, Status> {
        forward_unary!(self, request, update_group)
    }

    async fn delete_group(
        &self,
        request: Request<v2::MlsDeleteGroupRequest>,
    ) -> Result<Response<v2::MlsDeleteGroupResponse>, Status> {
        forward_unary!(self, request, delete_group)
    }

    async fn add_group_member(
        &self,
        request: Request<v2::MlsAddGroupMemberRequest>,
    ) -> Result<Response<v2::MlsAddGroupMemberResponse>, Status> {
        forward_unary!(self, request, add_group_member)
    }

    async fn get_group_members(
        &self,
        request: Request<v2::MlsGetGroupMembersRequest>,
    ) -> Result<Response<v2::MlsGetGroupMembersResponse>, Status> {
        forward_unary!(self, request, get_group_members)
    }

    async fn remove_group_member(
        &self,
        request: Request<v2::MlsRemoveGroupMemberRequest>,
    ) -> Result<Response<v2::MlsRemoveGroupMemberResponse>, Status> {
        forward_unary!(self, request, remove_group_member)
    }

    async fn send_group_message(
        &self,
        request: Request<v2::MlsSendGroupMessageRequest>,
    ) -> Result<Response<v2::MlsSendGroupMessageResponse>, Status> {
        forward_unary!(self, request, send_group_message)
    }

    async fn get_group_messages(
        &self,
        request: Request<v2::MlsGetGroupMessagesRequest>,
    ) -> Result<Response<v2::MlsGetGroupMessagesResponse>, Status> {
        forward_unary!(self, request, get_group_messages)
    }

    async fn get_group_state(
        &self,
        request: Request<v2::MlsGetGroupStateRequest>,
    ) -> Result<Response<v2::MlsGetGroupStateResponse>, Status> {
        forward_unary!(self, request, get_group_state)
    }

    async fn upload_group_state(
        &self,
        request: Request<v2::MlsUploadGroupStateRequest>,
    ) -> Result<Response<v2::MlsUploadGroupStateResponse>, Status> {
        forward_unary!(self, request, upload_group_state)
    }

    async fn get_welcome_messages(
        &self,
        request: Request<v2::MlsGetWelcomeMessagesRequest>,
    ) -> Result<Response<v2::MlsGetWelcomeMessagesResponse>, Status> {
        forward_unary!(self, request, get_welcome_messages)
    }

    async fn acknowledge_welcome(
        &self,
        request: Request<v2::MlsAcknowledgeWelcomeRequest>,
    ) -> Result<Response<v2::MlsAcknowledgeWelcomeResponse>, Status> {
        forward_unary!(self, request, acknowledge_welcome)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use tearleads_api_v2_contracts::tearleads::v2::mls_service_server::MlsService;
    use tonic::{Code, Request};

    use super::MlsServiceHandler;
    use crate::upstream_connect::UpstreamConnectClientFactory;

    fn invalid_handler() -> MlsServiceHandler {
        MlsServiceHandler::with_upstream(UpstreamConnectClientFactory::from_url(
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
                .upload_key_packages(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(
            handler
                .get_my_key_packages(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(
            handler
                .get_user_key_packages(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(
            handler
                .delete_key_package(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(handler.create_group(Request::new(Default::default())).await).await;
        assert_internal(handler.list_groups(Request::new(Default::default())).await).await;
        assert_internal(handler.get_group(Request::new(Default::default())).await).await;
        assert_internal(handler.update_group(Request::new(Default::default())).await).await;
        assert_internal(handler.delete_group(Request::new(Default::default())).await).await;
        assert_internal(
            handler
                .add_group_member(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(
            handler
                .get_group_members(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(
            handler
                .remove_group_member(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(
            handler
                .send_group_message(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(
            handler
                .get_group_messages(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(
            handler
                .get_group_state(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(
            handler
                .upload_group_state(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(
            handler
                .get_welcome_messages(Request::new(Default::default()))
                .await,
        )
        .await;
        assert_internal(
            handler
                .acknowledge_welcome(Request::new(Default::default()))
                .await,
        )
        .await;
    }

    #[test]
    fn constructors_and_default_are_usable() {
        let _ = MlsServiceHandler::new();
        let _ = MlsServiceHandler::default();
    }
}

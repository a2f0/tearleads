//! Native-mounted VFS service handler delegating to upstream RPC implementation.

use tearleads_api_v2_contracts::tearleads::v2::{
    self, vfs_service_client::VfsServiceClient, vfs_service_server::VfsService,
};
use tonic::{Request, Response, Status, transport::Channel};

use crate::upstream_connect::UpstreamConnectClientFactory;

/// Delegating `tearleads.v2.VfsService` implementation.
#[derive(Clone)]
pub struct VfsServiceHandler {
    upstream: UpstreamConnectClientFactory,
}

impl VfsServiceHandler {
    /// Creates a handler using runtime upstream endpoint config.
    pub fn new() -> Self {
        Self::with_upstream(UpstreamConnectClientFactory::from_env())
    }

    /// Creates a handler from explicit upstream endpoint factory.
    pub fn with_upstream(upstream: UpstreamConnectClientFactory) -> Self {
        Self { upstream }
    }

    fn client(&self) -> Result<VfsServiceClient<Channel>, Status> {
        Ok(VfsServiceClient::new(self.upstream.channel()?))
    }
}

impl Default for VfsServiceHandler {
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
impl VfsService for VfsServiceHandler {
    async fn get_my_keys(
        &self,
        request: Request<v2::VfsGetMyKeysRequest>,
    ) -> Result<Response<v2::VfsGetMyKeysResponse>, Status> {
        forward_unary!(self, request, get_my_keys)
    }

    async fn setup_keys(
        &self,
        request: Request<v2::VfsSetupKeysRequest>,
    ) -> Result<Response<v2::VfsSetupKeysResponse>, Status> {
        forward_unary!(self, request, setup_keys)
    }

    async fn register(
        &self,
        request: Request<v2::VfsRegisterRequest>,
    ) -> Result<Response<v2::VfsRegisterResponse>, Status> {
        forward_unary!(self, request, register)
    }

    async fn get_blob(
        &self,
        request: Request<v2::VfsGetBlobRequest>,
    ) -> Result<Response<v2::VfsGetBlobResponse>, Status> {
        forward_unary!(self, request, get_blob)
    }

    async fn delete_blob(
        &self,
        request: Request<v2::VfsDeleteBlobRequest>,
    ) -> Result<Response<v2::VfsDeleteBlobResponse>, Status> {
        forward_unary!(self, request, delete_blob)
    }

    async fn stage_blob(
        &self,
        request: Request<v2::VfsStageBlobRequest>,
    ) -> Result<Response<v2::VfsStageBlobResponse>, Status> {
        forward_unary!(self, request, stage_blob)
    }

    async fn upload_blob_chunk(
        &self,
        request: Request<v2::VfsUploadBlobChunkRequest>,
    ) -> Result<Response<v2::VfsUploadBlobChunkResponse>, Status> {
        forward_unary!(self, request, upload_blob_chunk)
    }

    async fn attach_blob(
        &self,
        request: Request<v2::VfsAttachBlobRequest>,
    ) -> Result<Response<v2::VfsAttachBlobResponse>, Status> {
        forward_unary!(self, request, attach_blob)
    }

    async fn abandon_blob(
        &self,
        request: Request<v2::VfsAbandonBlobRequest>,
    ) -> Result<Response<v2::VfsAbandonBlobResponse>, Status> {
        forward_unary!(self, request, abandon_blob)
    }

    async fn commit_blob(
        &self,
        request: Request<v2::VfsCommitBlobRequest>,
    ) -> Result<Response<v2::VfsCommitBlobResponse>, Status> {
        forward_unary!(self, request, commit_blob)
    }

    async fn rekey_item(
        &self,
        request: Request<v2::VfsRekeyItemRequest>,
    ) -> Result<Response<v2::VfsRekeyItemResponse>, Status> {
        forward_unary!(self, request, rekey_item)
    }

    async fn push_crdt_ops(
        &self,
        request: Request<v2::VfsPushCrdtOpsRequest>,
    ) -> Result<Response<v2::VfsPushCrdtOpsResponse>, Status> {
        forward_unary!(self, request, push_crdt_ops)
    }

    async fn reconcile_crdt(
        &self,
        request: Request<v2::VfsReconcileCrdtRequest>,
    ) -> Result<Response<v2::VfsReconcileCrdtResponse>, Status> {
        forward_unary!(self, request, reconcile_crdt)
    }

    async fn reconcile_sync(
        &self,
        request: Request<v2::VfsReconcileSyncRequest>,
    ) -> Result<Response<v2::VfsReconcileSyncResponse>, Status> {
        forward_unary!(self, request, reconcile_sync)
    }

    async fn run_crdt_session(
        &self,
        request: Request<v2::VfsRunCrdtSessionRequest>,
    ) -> Result<Response<v2::VfsRunCrdtSessionResponse>, Status> {
        forward_unary!(self, request, run_crdt_session)
    }

    async fn get_sync(
        &self,
        request: Request<v2::VfsGetSyncRequest>,
    ) -> Result<Response<v2::VfsGetSyncResponse>, Status> {
        forward_unary!(self, request, get_sync)
    }

    async fn get_crdt_sync(
        &self,
        request: Request<v2::VfsGetCrdtSyncRequest>,
    ) -> Result<Response<v2::VfsGetCrdtSyncResponse>, Status> {
        forward_unary!(self, request, get_crdt_sync)
    }

    async fn get_crdt_snapshot(
        &self,
        request: Request<v2::VfsGetCrdtSnapshotRequest>,
    ) -> Result<Response<v2::VfsGetCrdtSnapshotResponse>, Status> {
        forward_unary!(self, request, get_crdt_snapshot)
    }

    async fn get_emails(
        &self,
        request: Request<v2::VfsGetEmailsRequest>,
    ) -> Result<Response<v2::VfsGetEmailsResponse>, Status> {
        forward_unary!(self, request, get_emails)
    }

    async fn get_email(
        &self,
        request: Request<v2::VfsGetEmailRequest>,
    ) -> Result<Response<v2::VfsGetEmailResponse>, Status> {
        forward_unary!(self, request, get_email)
    }

    async fn delete_email(
        &self,
        request: Request<v2::VfsDeleteEmailRequest>,
    ) -> Result<Response<v2::VfsDeleteEmailResponse>, Status> {
        forward_unary!(self, request, delete_email)
    }

    async fn send_email(
        &self,
        request: Request<v2::VfsSendEmailRequest>,
    ) -> Result<Response<v2::VfsSendEmailResponse>, Status> {
        forward_unary!(self, request, send_email)
    }
}

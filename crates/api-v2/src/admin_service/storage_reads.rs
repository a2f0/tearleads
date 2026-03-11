use tearleads_api_v2_contracts::tearleads::v2::{
    AdminGetPostgresInfoRequest, AdminGetPostgresInfoResponse, AdminPostgresConnectionInfo,
};
use tearleads_data_access_traits::{PostgresAdminRepository, RedisAdminRepository};
use tonic::{Request, Response, Status};

use crate::admin_auth::{AdminOperation, AdminRequestAuthorizer, map_admin_auth_error};
use crate::admin_service_common::map_data_access_error;

use super::AdminServiceHandler;

impl<P, R, A> AdminServiceHandler<P, R, A>
where
    P: PostgresAdminRepository + Send + Sync + 'static,
    R: RedisAdminRepository + Send + Sync + 'static,
    A: AdminRequestAuthorizer + Send + Sync + 'static,
{
    pub(super) async fn get_postgres_info_impl(
        &self,
        request: Request<AdminGetPostgresInfoRequest>,
    ) -> Result<Response<AdminGetPostgresInfoResponse>, Status> {
        self.authorizer
            .authorize_admin_operation(AdminOperation::GetPostgresInfo, request.metadata())
            .map_err(map_admin_auth_error)?;
        let snapshot = self
            .postgres_repo
            .get_postgres_info()
            .await
            .map_err(map_data_access_error)?;
        let response = AdminGetPostgresInfoResponse {
            info: Some(AdminPostgresConnectionInfo {
                host: snapshot.connection.host,
                port: snapshot.connection.port.map(u32::from),
                database: snapshot.connection.database,
                user: snapshot.connection.user,
            }),
            server_version: snapshot.server_version,
        };
        Ok(Response::new(response))
    }
}

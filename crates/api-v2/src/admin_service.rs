//! Contract-first admin RPC handlers backed by repository traits.

mod detail_reads;
mod group_mutations;

use tearleads_api_v2_contracts::tearleads::v2::{
    AdminAddGroupMemberRequest, AdminAddGroupMemberResponse, AdminCreateGroupRequest,
    AdminCreateGroupResponse, AdminDeleteGroupRequest, AdminDeleteGroupResponse,
    AdminDeleteRedisKeyRequest, AdminDeleteRedisKeyResponse, AdminGetColumnsRequest,
    AdminGetColumnsResponse, AdminGetContextRequest, AdminGetContextResponse,
    AdminGetGroupMembersRequest, AdminGetGroupMembersResponse, AdminGetGroupRequest,
    AdminGetGroupResponse, AdminGetOrgGroupsRequest, AdminGetOrgGroupsResponse,
    AdminGetOrgUsersRequest, AdminGetOrgUsersResponse, AdminGetOrganizationRequest,
    AdminGetOrganizationResponse, AdminGetPostgresInfoRequest, AdminGetPostgresInfoResponse,
    AdminGetRedisDbSizeRequest, AdminGetRedisDbSizeResponse, AdminGetRedisKeysRequest,
    AdminGetRedisKeysResponse, AdminGetRedisValueRequest, AdminGetRedisValueResponse,
    AdminGetRowsRequest, AdminGetRowsResponse, AdminGetTablesRequest, AdminGetTablesResponse,
    AdminGetUserRequest, AdminGetUserResponse, AdminListGroupsRequest, AdminListGroupsResponse,
    AdminListOrganizationsRequest, AdminListOrganizationsResponse, AdminListUsersRequest,
    AdminListUsersResponse, AdminPostgresColumnInfo, AdminPostgresConnectionInfo,
    AdminPostgresTableInfo, AdminRedisKeyInfo, AdminRemoveGroupMemberRequest,
    AdminRemoveGroupMemberResponse, AdminUpdateGroupRequest, AdminUpdateGroupResponse,
    admin_service_server::AdminService,
};
use tearleads_data_access_traits::{
    PostgresAdminReadRepository, PostgresRowsQuery, RedisAdminRepository,
};
use tonic::{Request, Response, Status};

use crate::admin_auth::{
    AdminOperation, AdminRequestAuthorizer, HeaderRoleAdminAuthorizer, map_admin_auth_error,
};
use crate::admin_service_common::{
    map_data_access_error, map_redis_value, normalize_redis_key, normalize_rows_limit,
    normalize_schema_or_table, normalize_sort_direction, parse_row_struct,
};

/// Trait-backed implementation of `tearleads.v2.AdminService`.
pub struct AdminServiceHandler<P, R, A = HeaderRoleAdminAuthorizer> {
    postgres_repo: P,
    redis_repo: R,
    authorizer: A,
}

impl<P, R, A> AdminServiceHandler<P, R, A> {
    /// Creates a new admin handler from repository and auth policy implementations.
    pub fn with_authorizer(postgres_repo: P, redis_repo: R, authorizer: A) -> Self {
        Self {
            postgres_repo,
            redis_repo,
            authorizer,
        }
    }
}

impl<P, R> AdminServiceHandler<P, R, HeaderRoleAdminAuthorizer> {
    /// Creates a new admin handler from repository implementations.
    pub fn new(postgres_repo: P, redis_repo: R) -> Self {
        Self::with_authorizer(postgres_repo, redis_repo, HeaderRoleAdminAuthorizer)
    }
}

#[tonic::async_trait]
impl<P, R, A> AdminService for AdminServiceHandler<P, R, A>
where
    P: PostgresAdminReadRepository + Send + Sync + 'static,
    R: RedisAdminRepository + Send + Sync + 'static,
    A: AdminRequestAuthorizer + Send + Sync + 'static,
{
    async fn get_context(
        &self,
        request: Request<AdminGetContextRequest>,
    ) -> Result<Response<AdminGetContextResponse>, Status> {
        self.get_context_impl(request).await
    }

    async fn get_postgres_info(
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

    async fn list_groups(
        &self,
        request: Request<AdminListGroupsRequest>,
    ) -> Result<Response<AdminListGroupsResponse>, Status> {
        self.list_groups_impl(request).await
    }

    async fn get_group(
        &self,
        request: Request<AdminGetGroupRequest>,
    ) -> Result<Response<AdminGetGroupResponse>, Status> {
        self.get_group_impl(request).await
    }

    async fn create_group(
        &self,
        request: Request<AdminCreateGroupRequest>,
    ) -> Result<Response<AdminCreateGroupResponse>, Status> {
        self.create_group_impl(request).await
    }

    async fn update_group(
        &self,
        request: Request<AdminUpdateGroupRequest>,
    ) -> Result<Response<AdminUpdateGroupResponse>, Status> {
        self.update_group_impl(request).await
    }

    async fn delete_group(
        &self,
        request: Request<AdminDeleteGroupRequest>,
    ) -> Result<Response<AdminDeleteGroupResponse>, Status> {
        self.delete_group_impl(request).await
    }

    async fn get_group_members(
        &self,
        request: Request<AdminGetGroupMembersRequest>,
    ) -> Result<Response<AdminGetGroupMembersResponse>, Status> {
        self.get_group_members_impl(request).await
    }

    async fn add_group_member(
        &self,
        request: Request<AdminAddGroupMemberRequest>,
    ) -> Result<Response<AdminAddGroupMemberResponse>, Status> {
        self.add_group_member_impl(request).await
    }

    async fn remove_group_member(
        &self,
        request: Request<AdminRemoveGroupMemberRequest>,
    ) -> Result<Response<AdminRemoveGroupMemberResponse>, Status> {
        self.remove_group_member_impl(request).await
    }

    async fn list_organizations(
        &self,
        request: Request<AdminListOrganizationsRequest>,
    ) -> Result<Response<AdminListOrganizationsResponse>, Status> {
        self.list_organizations_impl(request).await
    }

    async fn get_organization(
        &self,
        request: Request<AdminGetOrganizationRequest>,
    ) -> Result<Response<AdminGetOrganizationResponse>, Status> {
        self.get_organization_impl(request).await
    }

    async fn get_org_users(
        &self,
        request: Request<AdminGetOrgUsersRequest>,
    ) -> Result<Response<AdminGetOrgUsersResponse>, Status> {
        self.get_org_users_impl(request).await
    }

    async fn get_org_groups(
        &self,
        request: Request<AdminGetOrgGroupsRequest>,
    ) -> Result<Response<AdminGetOrgGroupsResponse>, Status> {
        self.get_org_groups_impl(request).await
    }

    async fn list_users(
        &self,
        request: Request<AdminListUsersRequest>,
    ) -> Result<Response<AdminListUsersResponse>, Status> {
        self.list_users_impl(request).await
    }

    async fn get_user(
        &self,
        request: Request<AdminGetUserRequest>,
    ) -> Result<Response<AdminGetUserResponse>, Status> {
        self.get_user_impl(request).await
    }

    async fn get_tables(
        &self,
        request: Request<AdminGetTablesRequest>,
    ) -> Result<Response<AdminGetTablesResponse>, Status> {
        self.authorizer
            .authorize_admin_operation(AdminOperation::GetTables, request.metadata())
            .map_err(map_admin_auth_error)?;
        let tables = self
            .postgres_repo
            .list_tables()
            .await
            .map_err(map_data_access_error)?
            .into_iter()
            .map(|table| AdminPostgresTableInfo {
                schema: table.schema,
                name: table.name,
                row_count: table.row_count,
                total_bytes: table.total_bytes,
                table_bytes: table.table_bytes,
                index_bytes: table.index_bytes,
            })
            .collect();
        Ok(Response::new(AdminGetTablesResponse { tables }))
    }

    async fn get_columns(
        &self,
        request: Request<AdminGetColumnsRequest>,
    ) -> Result<Response<AdminGetColumnsResponse>, Status> {
        self.authorizer
            .authorize_admin_operation(AdminOperation::GetColumns, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let schema = normalize_schema_or_table("schema", &payload.schema)
            .map_err(Status::invalid_argument)?;
        let table =
            normalize_schema_or_table("table", &payload.table).map_err(Status::invalid_argument)?;
        let columns = self
            .postgres_repo
            .list_columns(&schema, &table)
            .await
            .map_err(map_data_access_error)?
            .into_iter()
            .map(|column| AdminPostgresColumnInfo {
                name: column.name,
                r#type: column.data_type,
                nullable: column.nullable,
                default_value: column.default_value,
                ordinal_position: column.ordinal_position,
            })
            .collect();
        Ok(Response::new(AdminGetColumnsResponse { columns }))
    }

    async fn get_rows(
        &self,
        request: Request<AdminGetRowsRequest>,
    ) -> Result<Response<AdminGetRowsResponse>, Status> {
        self.authorizer
            .authorize_admin_operation(AdminOperation::GetRows, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let schema = normalize_schema_or_table("schema", &payload.schema)
            .map_err(Status::invalid_argument)?;
        let table =
            normalize_schema_or_table("table", &payload.table).map_err(Status::invalid_argument)?;
        let sort_column = payload
            .sort_column
            .map(|value| normalize_schema_or_table("sortColumn", &value))
            .transpose()
            .map_err(Status::invalid_argument)?;
        let sort_direction =
            normalize_sort_direction(payload.sort_direction).map_err(Status::invalid_argument)?;
        let limit = normalize_rows_limit(payload.limit);

        let rows_page = self
            .postgres_repo
            .list_rows(PostgresRowsQuery {
                schema,
                table,
                limit,
                offset: payload.offset,
                sort_column,
                sort_direction,
            })
            .await
            .map_err(map_data_access_error)?;

        let rows = rows_page
            .rows_json
            .iter()
            .enumerate()
            .map(|(index, row_json)| {
                parse_row_struct(row_json).map_err(|error| {
                    Status::internal(format!("failed to encode row {index}: {error}"))
                })
            })
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Response::new(AdminGetRowsResponse {
            rows,
            total_count: rows_page.total_count,
            limit: rows_page.limit,
            offset: rows_page.offset,
        }))
    }

    async fn get_redis_keys(
        &self,
        request: Request<AdminGetRedisKeysRequest>,
    ) -> Result<Response<AdminGetRedisKeysResponse>, Status> {
        self.authorizer
            .authorize_admin_operation(AdminOperation::GetRedisKeys, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        if payload.limit < 0 {
            return Err(Status::invalid_argument("limit must be non-negative"));
        }
        let limit = payload.limit as u32;
        let page = self
            .redis_repo
            .list_keys(&payload.cursor, limit)
            .await
            .map_err(map_data_access_error)?;
        let keys = page
            .keys
            .into_iter()
            .map(|key| AdminRedisKeyInfo {
                key: key.key,
                r#type: key.key_type,
                ttl: key.ttl_seconds,
            })
            .collect();
        Ok(Response::new(AdminGetRedisKeysResponse {
            keys,
            cursor: page.cursor,
            has_more: page.has_more,
        }))
    }

    async fn get_redis_value(
        &self,
        request: Request<AdminGetRedisValueRequest>,
    ) -> Result<Response<AdminGetRedisValueResponse>, Status> {
        self.authorizer
            .authorize_admin_operation(AdminOperation::GetRedisValue, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let key = normalize_redis_key(&payload.key).map_err(Status::invalid_argument)?;
        let value_record = self
            .redis_repo
            .get_value(&key)
            .await
            .map_err(map_data_access_error)?;
        let response = AdminGetRedisValueResponse {
            key: value_record.key,
            r#type: value_record.key_type,
            ttl: value_record.ttl_seconds,
            value: map_redis_value(value_record.value),
        };
        Ok(Response::new(response))
    }

    async fn delete_redis_key(
        &self,
        request: Request<AdminDeleteRedisKeyRequest>,
    ) -> Result<Response<AdminDeleteRedisKeyResponse>, Status> {
        self.authorizer
            .authorize_admin_operation(AdminOperation::DeleteRedisKey, request.metadata())
            .map_err(map_admin_auth_error)?;
        let payload = request.into_inner();
        let key = normalize_redis_key(&payload.key).map_err(Status::invalid_argument)?;
        let deleted = self
            .redis_repo
            .delete_key(&key)
            .await
            .map_err(map_data_access_error)?;

        Ok(Response::new(AdminDeleteRedisKeyResponse { deleted }))
    }

    async fn get_redis_db_size(
        &self,
        request: Request<AdminGetRedisDbSizeRequest>,
    ) -> Result<Response<AdminGetRedisDbSizeResponse>, Status> {
        self.authorizer
            .authorize_admin_operation(AdminOperation::GetRedisDbSize, request.metadata())
            .map_err(map_admin_auth_error)?;
        let _ = request.into_inner();
        let count = self
            .redis_repo
            .get_db_size()
            .await
            .map_err(map_data_access_error)?;

        Ok(Response::new(AdminGetRedisDbSizeResponse { count }))
    }
}

//! Contract-first admin RPC handlers backed by repository traits.

use std::collections::HashMap;

use prost_types::{ListValue, Struct, Value, value::Kind as ProtobufValueKind};
use serde_json::Value as JsonValue;
use tearleads_api_domain_core::normalize_sql_identifier;
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminDeleteRedisKeyRequest, AdminDeleteRedisKeyResponse, AdminGetColumnsRequest,
    AdminGetColumnsResponse, AdminGetPostgresInfoRequest, AdminGetPostgresInfoResponse,
    AdminGetRedisDbSizeRequest, AdminGetRedisDbSizeResponse, AdminGetRedisKeysRequest,
    AdminGetRedisKeysResponse, AdminGetRedisValueRequest, AdminGetRedisValueResponse,
    AdminGetRowsRequest, AdminGetRowsResponse, AdminGetTablesRequest, AdminGetTablesResponse,
    AdminPostgresColumnInfo, AdminPostgresConnectionInfo, AdminPostgresTableInfo,
    AdminRedisKeyInfo, AdminRedisStringList, AdminRedisStringMap, AdminRedisValue,
    admin_redis_value, admin_service_server::AdminService,
};
use tearleads_data_access_traits::{
    DataAccessError, DataAccessErrorKind, PostgresAdminReadRepository, PostgresRowsQuery,
    RedisAdminRepository, RedisValue,
};
use tonic::{Request, Response, Status};

use crate::admin_auth::{
    AdminOperation, AdminRequestAuthorizer, HeaderRoleAdminAuthorizer, map_admin_auth_error,
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
                parse_row_struct(row_json)
                    .map_err(|error| Status::internal(format!("failed to encode row {index}: {error}")))
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

fn map_redis_value(value: Option<RedisValue>) -> Option<AdminRedisValue> {
    value.map(|value_variant| match value_variant {
        RedisValue::String(string_value) => AdminRedisValue {
            value: Some(admin_redis_value::Value::StringValue(string_value)),
        },
        RedisValue::List(values) => AdminRedisValue {
            value: Some(admin_redis_value::Value::ListValue(AdminRedisStringList {
                values,
            })),
        },
        RedisValue::Map(entries) => AdminRedisValue {
            value: Some(admin_redis_value::Value::MapValue(AdminRedisStringMap {
                entries: entries.into_iter().collect::<HashMap<_, _>>(),
            })),
        },
    })
}

fn map_data_access_error(error: DataAccessError) -> Status {
    match error.kind() {
        DataAccessErrorKind::NotFound => Status::not_found(error.message().to_string()),
        DataAccessErrorKind::PermissionDenied => {
            Status::permission_denied(error.message().to_string())
        }
        DataAccessErrorKind::InvalidInput => Status::invalid_argument(error.message().to_string()),
        DataAccessErrorKind::Unavailable => Status::unavailable("upstream store unavailable"),
        DataAccessErrorKind::Internal => Status::internal("internal data access error"),
    }
}

fn normalize_schema_or_table(field: &'static str, value: &str) -> Result<String, String> {
    normalize_sql_identifier(field, value).map_err(|error| error.message().to_string())
}

fn normalize_redis_key(key: &str) -> Result<String, &'static str> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("key must not be empty");
    }
    Ok(trimmed.to_string())
}

fn normalize_sort_direction(value: Option<String>) -> Result<Option<String>, &'static str> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if trimmed.eq_ignore_ascii_case("asc") {
        return Ok(Some(String::from("asc")));
    }
    if trimmed.eq_ignore_ascii_case("desc") {
        return Ok(Some(String::from("desc")));
    }

    Err("sort_direction must be \"asc\" or \"desc\"")
}

fn normalize_rows_limit(limit: u32) -> u32 {
    if limit == 0 {
        return 50;
    }
    limit.min(1000)
}

fn parse_row_struct(row_json: &str) -> Result<Struct, String> {
    let parsed_value: JsonValue = serde_json::from_str(row_json)
        .map_err(|error| format!("invalid JSON payload: {error}"))?;

    let JsonValue::Object(object) = parsed_value else {
        return Err(String::from("row payload must decode to an object"));
    };

    let fields = object
        .into_iter()
        .map(|(key, value)| (key, json_value_to_protobuf_value(value)))
        .collect();

    Ok(Struct { fields })
}

fn json_value_to_protobuf_value(value: JsonValue) -> Value {
    let kind = match value {
        JsonValue::Null => ProtobufValueKind::NullValue(0),
        JsonValue::Bool(boolean) => ProtobufValueKind::BoolValue(boolean),
        JsonValue::Number(number) => {
            let as_f64 = number
                .as_f64()
                .expect("serde_json::Number should always convert to f64");
            ProtobufValueKind::NumberValue(as_f64)
        }
        JsonValue::String(string_value) => ProtobufValueKind::StringValue(string_value),
        JsonValue::Array(list_values) => {
            ProtobufValueKind::ListValue(ListValue {
                values: list_values
                    .into_iter()
                    .map(json_value_to_protobuf_value)
                    .collect(),
            })
        }
        JsonValue::Object(map_values) => ProtobufValueKind::StructValue(Struct {
            fields: map_values
                .into_iter()
                .map(|(key, map_value)| (key, json_value_to_protobuf_value(map_value)))
                .collect(),
        }),
    };

    Value { kind: Some(kind) }
}

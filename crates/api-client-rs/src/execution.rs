//! Runtime RPC execution helpers for API v2 Rust clients.

use std::fmt;

use tonic::metadata::{Ascii, MetadataKey, MetadataValue};
use tonic::service::Interceptor;
use tonic::transport::{Channel, Endpoint};
use tonic::{Request, Status};

use crate::{ApiClientRequestContext, normalize_connect_base_url, v2};

#[derive(Debug, Clone, PartialEq, Eq)]
/// Errors returned by API v2 RPC client execution helpers.
pub enum ApiClientRpcError {
    /// The provided API base URL could not be converted to a tonic endpoint URI.
    InvalidBaseUrl(String),
    /// A request context header key was not a valid gRPC metadata key.
    InvalidHeaderName(String),
    /// A request context header value was not a valid ASCII gRPC metadata value.
    InvalidHeaderValue(String),
    /// Transport-level connection or IO failure.
    Transport(String),
    /// gRPC status returned by the server.
    Status {
        /// gRPC status code returned by the server.
        code: tonic::Code,
        /// gRPC status message returned by the server.
        message: String,
    },
}

impl fmt::Display for ApiClientRpcError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBaseUrl(message) => write!(formatter, "invalid RPC base URL: {message}"),
            Self::InvalidHeaderName(name) => {
                write!(formatter, "invalid RPC header name: {name}")
            }
            Self::InvalidHeaderValue(name) => {
                write!(formatter, "invalid RPC header value for {name}")
            }
            Self::Transport(message) => write!(formatter, "RPC transport error: {message}"),
            Self::Status { code, message } => {
                write!(formatter, "RPC status error ({code}): {message}")
            }
        }
    }
}

impl std::error::Error for ApiClientRpcError {}

impl From<tonic::transport::Error> for ApiClientRpcError {
    fn from(error: tonic::transport::Error) -> Self {
        Self::Transport(error.to_string())
    }
}

impl From<Status> for ApiClientRpcError {
    fn from(status: Status) -> Self {
        Self::Status {
            code: status.code(),
            message: status.message().to_string(),
        }
    }
}

type ParsedMetadataPairs = Vec<(MetadataKey<Ascii>, MetadataValue<Ascii>)>;

fn parse_metadata_pairs(
    header_pairs: &[(String, String)],
) -> Result<ParsedMetadataPairs, ApiClientRpcError> {
    let mut metadata_pairs = Vec::with_capacity(header_pairs.len());
    for (name, value) in header_pairs {
        let key = MetadataKey::from_bytes(name.as_bytes())
            .map_err(|_| ApiClientRpcError::InvalidHeaderName(name.clone()))?;
        let metadata_value = MetadataValue::try_from(value.as_str())
            .map_err(|_| ApiClientRpcError::InvalidHeaderValue(name.clone()))?;
        metadata_pairs.push((key, metadata_value));
    }
    Ok(metadata_pairs)
}

#[derive(Debug, Clone, Default)]
struct MetadataInjector {
    metadata_pairs: ParsedMetadataPairs,
}

impl MetadataInjector {
    fn from_request_context(
        request_context: &ApiClientRequestContext,
    ) -> Result<Self, ApiClientRpcError> {
        let header_pairs = request_context.header_pairs();
        let metadata_pairs = parse_metadata_pairs(&header_pairs)?;
        Ok(Self { metadata_pairs })
    }
}

impl Interceptor for MetadataInjector {
    fn call(&mut self, mut request: Request<()>) -> Result<Request<()>, Status> {
        for (name, value) in &self.metadata_pairs {
            request.metadata_mut().insert(name.clone(), value.clone());
        }
        Ok(request)
    }
}

fn endpoint_from_base_url(base_url: &str) -> Result<Endpoint, ApiClientRpcError> {
    let connect_base_url = normalize_connect_base_url(base_url);
    Endpoint::from_shared(connect_base_url.clone())
        .map_err(|error| ApiClientRpcError::InvalidBaseUrl(format!("{connect_base_url}: {error}")))
}

async fn connect_channel(base_url: &str) -> Result<Channel, ApiClientRpcError> {
    let endpoint = endpoint_from_base_url(base_url)?;
    let channel = endpoint.connect().await?;
    Ok(channel)
}

type InterceptedChannel =
    tonic::service::interceptor::InterceptedService<Channel, MetadataInjector>;

/// Networked v2 AdminService RPC client over tonic transport.
pub struct AdminRpcClient {
    inner: v2::admin_service_client::AdminServiceClient<InterceptedChannel>,
}

impl AdminRpcClient {
    /// Builds an admin RPC client from an existing tonic channel.
    pub fn from_channel(
        channel: Channel,
        request_context: ApiClientRequestContext,
    ) -> Result<Self, ApiClientRpcError> {
        let interceptor = MetadataInjector::from_request_context(&request_context)?;
        let client =
            v2::admin_service_client::AdminServiceClient::with_interceptor(channel, interceptor);
        Ok(Self { inner: client })
    }

    /// Connects to an admin RPC endpoint using the provided API base URL.
    pub async fn connect(
        base_url: &str,
        request_context: ApiClientRequestContext,
    ) -> Result<Self, ApiClientRpcError> {
        let channel = connect_channel(base_url).await?;
        Self::from_channel(channel, request_context)
    }

    /// Executes `AdminService.GetContext`.
    pub async fn get_context(&mut self) -> Result<v2::AdminGetContextResponse, ApiClientRpcError> {
        let response = self
            .inner
            .get_context(Request::new(v2::AdminGetContextRequest {}))
            .await?;
        Ok(response.into_inner())
    }

    /// Executes `AdminService.GetPostgresInfo`.
    pub async fn get_postgres_info(
        &mut self,
    ) -> Result<v2::AdminGetPostgresInfoResponse, ApiClientRpcError> {
        let response = self
            .inner
            .get_postgres_info(Request::new(v2::AdminGetPostgresInfoRequest {}))
            .await?;
        Ok(response.into_inner())
    }

    /// Executes `AdminService.GetTables`.
    pub async fn get_tables(&mut self) -> Result<v2::AdminGetTablesResponse, ApiClientRpcError> {
        let response = self
            .inner
            .get_tables(Request::new(v2::AdminGetTablesRequest {}))
            .await?;
        Ok(response.into_inner())
    }

    /// Executes `AdminService.GetColumns`.
    pub async fn get_columns(
        &mut self,
        request: v2::AdminGetColumnsRequest,
    ) -> Result<v2::AdminGetColumnsResponse, ApiClientRpcError> {
        let response = self.inner.get_columns(Request::new(request)).await?;
        Ok(response.into_inner())
    }

    /// Executes `AdminService.GetRows`.
    pub async fn get_rows(
        &mut self,
        request: v2::AdminGetRowsRequest,
    ) -> Result<v2::AdminGetRowsResponse, ApiClientRpcError> {
        let response = self.inner.get_rows(Request::new(request)).await?;
        Ok(response.into_inner())
    }

    /// Executes `AdminService.GetRedisKeys`.
    pub async fn get_redis_keys(
        &mut self,
        request: v2::AdminGetRedisKeysRequest,
    ) -> Result<v2::AdminGetRedisKeysResponse, ApiClientRpcError> {
        let response = self.inner.get_redis_keys(Request::new(request)).await?;
        Ok(response.into_inner())
    }

    /// Executes `AdminService.GetRedisValue`.
    pub async fn get_redis_value(
        &mut self,
        request: v2::AdminGetRedisValueRequest,
    ) -> Result<v2::AdminGetRedisValueResponse, ApiClientRpcError> {
        let response = self.inner.get_redis_value(Request::new(request)).await?;
        Ok(response.into_inner())
    }

    /// Executes `AdminService.DeleteRedisKey`.
    pub async fn delete_redis_key(
        &mut self,
        request: v2::AdminDeleteRedisKeyRequest,
    ) -> Result<v2::AdminDeleteRedisKeyResponse, ApiClientRpcError> {
        let response = self.inner.delete_redis_key(Request::new(request)).await?;
        Ok(response.into_inner())
    }

    /// Executes `AdminService.GetRedisDbSize`.
    pub async fn get_redis_db_size(
        &mut self,
    ) -> Result<v2::AdminGetRedisDbSizeResponse, ApiClientRpcError> {
        let response = self
            .inner
            .get_redis_db_size(Request::new(v2::AdminGetRedisDbSizeRequest {}))
            .await?;
        Ok(response.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use tonic::service::Interceptor;
    use tonic::transport::{Channel, Endpoint};

    use super::{
        AdminRpcClient, ApiClientRpcError, MetadataInjector, endpoint_from_base_url,
        parse_metadata_pairs,
    };
    use crate::ApiClientRequestContext;

    #[test]
    fn parse_metadata_pairs_rejects_invalid_names() {
        let pairs = vec![(String::from("bad header"), String::from("value"))];
        let error = match parse_metadata_pairs(&pairs) {
            Ok(value) => panic!("invalid header names should fail, got: {value:?}"),
            Err(error) => error,
        };

        assert_eq!(
            error,
            ApiClientRpcError::InvalidHeaderName(String::from("bad header"))
        );
    }

    #[test]
    fn metadata_injector_applies_context_headers() {
        let request_context = ApiClientRequestContext {
            bearer_token: Some(String::from("token-123")),
            organization_id: Some(String::from("org_abc")),
        };
        let mut injector = match MetadataInjector::from_request_context(&request_context) {
            Ok(value) => value,
            Err(error) => panic!("request context should build metadata injector: {error}"),
        };

        let request: tonic::Request<()> = match injector.call(tonic::Request::new(())) {
            Ok(value) => value,
            Err(error) => panic!("metadata injection should succeed: {error}"),
        };
        let metadata = request.metadata();

        assert_eq!(
            metadata
                .get("authorization")
                .and_then(|value| value.to_str().ok()),
            Some("Bearer token-123")
        );
        assert_eq!(
            metadata
                .get("x-tearleads-organization-id")
                .and_then(|value| value.to_str().ok()),
            Some("org_abc")
        );
    }

    #[test]
    fn endpoint_builder_rejects_relative_urls() {
        let error = match endpoint_from_base_url("not a url") {
            Ok(value) => panic!("empty base url should fail endpoint construction: {value:?}"),
            Err(error) => error,
        };
        assert!(
            matches!(error, ApiClientRpcError::InvalidBaseUrl(message) if message.contains("not a url"))
        );
    }

    #[tokio::test]
    async fn admin_client_constructs_from_lazy_channel() {
        let endpoint = Endpoint::from_static("http://localhost:5002/connect");
        let channel: Channel = endpoint.connect_lazy();
        let result = AdminRpcClient::from_channel(channel, ApiClientRequestContext::default());
        if let Err(error) = result {
            panic!("constructing client from lazy channel should succeed: {error}");
        }
    }
}

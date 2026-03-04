//! Auth policy boundaries for admin RPC handlers.

use tonic::{Status, metadata::MetadataMap};

/// Supported admin RPC operations requiring authorization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdminOperation {
    /// `AdminService.GetPostgresInfo`
    GetPostgresInfo,
    /// `AdminService.GetTables`
    GetTables,
    /// `AdminService.GetColumns`
    GetColumns,
    /// `AdminService.GetRows`
    GetRows,
    /// `AdminService.GetRedisKeys`
    GetRedisKeys,
    /// `AdminService.GetRedisValue`
    GetRedisValue,
    /// `AdminService.GetRedisDbSize`
    GetRedisDbSize,
}

impl AdminOperation {
    fn as_str(self) -> &'static str {
        match self {
            Self::GetPostgresInfo => "get_postgres_info",
            Self::GetTables => "get_tables",
            Self::GetColumns => "get_columns",
            Self::GetRows => "get_rows",
            Self::GetRedisKeys => "get_redis_keys",
            Self::GetRedisValue => "get_redis_value",
            Self::GetRedisDbSize => "get_redis_db_size",
        }
    }
}

/// Error categories returned by admin auth policy checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdminAuthErrorKind {
    /// Caller is not authenticated.
    Unauthenticated,
    /// Caller is authenticated but not authorized for the operation.
    PermissionDenied,
    /// Auth policy could not be evaluated due to internal errors.
    Internal,
}

/// Typed auth policy error for mapping into transport status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminAuthError {
    kind: AdminAuthErrorKind,
    message: String,
}

impl AdminAuthError {
    /// Constructs an auth policy error from kind and message.
    pub fn new(kind: AdminAuthErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    fn kind(&self) -> AdminAuthErrorKind {
        self.kind
    }

    fn message(&self) -> &str {
        &self.message
    }
}

/// Authorization boundary for admin handler operations.
pub trait AdminRequestAuthorizer: Send + Sync {
    /// Verifies that the request metadata grants access to the given operation.
    fn authorize_admin_operation(
        &self,
        operation: AdminOperation,
        metadata: &MetadataMap,
    ) -> Result<(), AdminAuthError>;
}

/// Header-based authorization policy requiring `x-tearleads-role: admin`.
#[derive(Debug, Clone, Copy)]
pub struct HeaderRoleAdminAuthorizer;

impl HeaderRoleAdminAuthorizer {
    const ROLE_HEADER: &'static str = "x-tearleads-role";
    const REQUIRED_ROLE: &'static str = "admin";
}

impl AdminRequestAuthorizer for HeaderRoleAdminAuthorizer {
    fn authorize_admin_operation(
        &self,
        operation: AdminOperation,
        metadata: &MetadataMap,
    ) -> Result<(), AdminAuthError> {
        let role_value = metadata.get(Self::ROLE_HEADER).ok_or_else(|| {
            AdminAuthError::new(
                AdminAuthErrorKind::Unauthenticated,
                format!("missing {} for {}", Self::ROLE_HEADER, operation.as_str()),
            )
        })?;

        let role = role_value.to_str().map_err(|_| {
            AdminAuthError::new(
                AdminAuthErrorKind::Unauthenticated,
                format!("invalid {} for {}", Self::ROLE_HEADER, operation.as_str()),
            )
        })?;

        if role != Self::REQUIRED_ROLE {
            return Err(AdminAuthError::new(
                AdminAuthErrorKind::PermissionDenied,
                format!("admin role required for {}", operation.as_str()),
            ));
        }

        Ok(())
    }
}

/// Maps an auth policy error to gRPC status.
pub fn map_admin_auth_error(error: AdminAuthError) -> Status {
    match error.kind() {
        AdminAuthErrorKind::Unauthenticated => Status::unauthenticated(error.message().to_string()),
        AdminAuthErrorKind::PermissionDenied => {
            Status::permission_denied(error.message().to_string())
        }
        AdminAuthErrorKind::Internal => Status::internal("admin authorization failed"),
    }
}

#[cfg(test)]
mod tests {
    use tonic::Code;

    use super::{
        AdminAuthError, AdminAuthErrorKind, AdminOperation, AdminRequestAuthorizer,
        HeaderRoleAdminAuthorizer, map_admin_auth_error,
    };

    #[test]
    fn header_role_authorizer_accepts_admin_role() {
        let authorizer = HeaderRoleAdminAuthorizer;
        let mut metadata = tonic::metadata::MetadataMap::new();
        metadata.insert(
            "x-tearleads-role",
            tonic::metadata::MetadataValue::from_static("admin"),
        );

        let result = authorizer.authorize_admin_operation(AdminOperation::GetTables, &metadata);
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn header_role_authorizer_rejects_missing_role_header() {
        let authorizer = HeaderRoleAdminAuthorizer;
        let metadata = tonic::metadata::MetadataMap::new();

        let result = authorizer.authorize_admin_operation(AdminOperation::GetTables, &metadata);
        assert!(result.is_err());
        assert_eq!(
            result.as_ref().err().map(|error| error.kind()),
            Some(AdminAuthErrorKind::Unauthenticated)
        );
        assert!(
            result
                .as_ref()
                .err()
                .map(|error| error.message().contains("missing x-tearleads-role"))
                .unwrap_or(false)
        );
    }

    #[test]
    fn header_role_authorizer_rejects_non_admin_role() {
        let authorizer = HeaderRoleAdminAuthorizer;
        let mut metadata = tonic::metadata::MetadataMap::new();
        metadata.insert(
            "x-tearleads-role",
            tonic::metadata::MetadataValue::from_static("member"),
        );

        let result = authorizer.authorize_admin_operation(AdminOperation::GetColumns, &metadata);
        assert!(result.is_err());
        assert_eq!(
            result.as_ref().err().map(|error| error.kind()),
            Some(AdminAuthErrorKind::PermissionDenied)
        );
        assert!(
            result
                .as_ref()
                .err()
                .map(|error| error.message().contains("admin role required"))
                .unwrap_or(false)
        );
    }

    #[test]
    fn header_role_authorizer_rejects_non_utf8_role_header() {
        let authorizer = HeaderRoleAdminAuthorizer;
        let mut metadata = tonic::metadata::MetadataMap::new();
        let invalid_role = parse_opaque_ascii_value(b"admin\xfa");
        metadata.insert("x-tearleads-role", invalid_role);

        let result = authorizer.authorize_admin_operation(AdminOperation::GetTables, &metadata);
        assert!(result.is_err());
        assert_eq!(
            result.as_ref().err().map(|error| error.kind()),
            Some(AdminAuthErrorKind::Unauthenticated)
        );
        assert!(
            result
                .as_ref()
                .err()
                .map(|error| error.message().contains("invalid x-tearleads-role"))
                .unwrap_or(false)
        );
    }

    #[test]
    #[should_panic(expected = "opaque ascii metadata value should parse")]
    fn parse_opaque_ascii_value_panics_for_invalid_ascii() {
        let _ = parse_opaque_ascii_value(b"\n");
    }

    #[test]
    fn map_admin_auth_error_translates_kinds_to_status_codes() {
        let unauthenticated = map_admin_auth_error(AdminAuthError::new(
            AdminAuthErrorKind::Unauthenticated,
            "login required",
        ));
        assert_eq!(unauthenticated.code(), Code::Unauthenticated);
        assert_eq!(unauthenticated.message(), "login required");

        let denied = map_admin_auth_error(AdminAuthError::new(
            AdminAuthErrorKind::PermissionDenied,
            "role mismatch",
        ));
        assert_eq!(denied.code(), Code::PermissionDenied);
        assert_eq!(denied.message(), "role mismatch");

        let internal = map_admin_auth_error(AdminAuthError::new(
            AdminAuthErrorKind::Internal,
            "token decoder crashed",
        ));
        assert_eq!(internal.code(), Code::Internal);
        assert_eq!(internal.message(), "admin authorization failed");
    }

    #[test]
    fn operation_strings_are_stable_for_error_messages() {
        let operations = [
            (AdminOperation::GetPostgresInfo, "get_postgres_info"),
            (AdminOperation::GetTables, "get_tables"),
            (AdminOperation::GetColumns, "get_columns"),
            (AdminOperation::GetRows, "get_rows"),
            (AdminOperation::GetRedisKeys, "get_redis_keys"),
            (AdminOperation::GetRedisValue, "get_redis_value"),
            (AdminOperation::GetRedisDbSize, "get_redis_db_size"),
        ];

        for (operation, expected_name) in operations {
            let error = AdminAuthError::new(
                AdminAuthErrorKind::Unauthenticated,
                format!("missing x-tearleads-role for {}", operation.as_str()),
            );
            assert!(error.message().contains(expected_name));
        }
    }

    fn parse_opaque_ascii_value(bytes: &[u8]) -> tonic::metadata::AsciiMetadataValue {
        match tonic::metadata::AsciiMetadataValue::try_from(bytes) {
            Ok(value) => value,
            Err(error) => panic!("opaque ascii metadata value should parse: {error}"),
        }
    }
}

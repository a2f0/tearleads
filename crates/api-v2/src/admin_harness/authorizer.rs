use crate::{
    AdminAccessContext, AdminAuthError, AdminAuthErrorKind, AdminOperation, AdminRequestAuthorizer,
};

#[derive(Debug, Clone, Copy)]
pub(crate) struct AuthorizationHeaderAdminAuthorizer;

impl AuthorizationHeaderAdminAuthorizer {
    const AUTHORIZATION_HEADER: &'static str = "authorization";

    fn unauthenticated_error(operation: AdminOperation, message: &str) -> AdminAuthError {
        AdminAuthError::new(AdminAuthErrorKind::Unauthenticated, {
            format!("{message} for {:?}", operation)
        })
    }

    fn validate_bearer_token(
        operation: AdminOperation,
        authorization: &str,
    ) -> Result<(), AdminAuthError> {
        let bearer_token = authorization
            .trim()
            .strip_prefix("Bearer ")
            .ok_or_else(|| {
                Self::unauthenticated_error(operation, "authorization must use Bearer token")
            })?;

        let segments: Vec<&str> = bearer_token.split('.').collect();
        if segments.len() != 3 || segments.iter().any(|segment| segment.is_empty()) {
            return Err(Self::unauthenticated_error(
                operation,
                "bearer token must be jwt-like",
            ));
        }

        Ok(())
    }
}

impl AdminRequestAuthorizer for AuthorizationHeaderAdminAuthorizer {
    fn authorize_admin_operation(
        &self,
        operation: AdminOperation,
        metadata: &tonic::metadata::MetadataMap,
    ) -> Result<AdminAccessContext, AdminAuthError> {
        let authorization = metadata
            .get(Self::AUTHORIZATION_HEADER)
            .ok_or_else(|| {
                AdminAuthError::new(
                    AdminAuthErrorKind::Unauthenticated,
                    format!("missing {} for {:?}", Self::AUTHORIZATION_HEADER, operation),
                )
            })?
            .to_str()
            .map_err(|_| {
                AdminAuthError::new(
                    AdminAuthErrorKind::Unauthenticated,
                    format!("invalid {} for {:?}", Self::AUTHORIZATION_HEADER, operation),
                )
            })?;

        Self::validate_bearer_token(operation, authorization)?;
        Ok(AdminAccessContext::root())
    }
}

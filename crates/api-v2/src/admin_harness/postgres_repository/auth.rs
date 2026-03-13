use tearleads_data_access_traits::{
    AuthLoginUser, AuthOrganization, AuthRegisterInput, AuthRegisteredUser, AuthUserOrganizations,
    BoxFuture, DataAccessError, DataAccessErrorKind, PostgresAuthRepository,
};

use super::{StaticPostgresRepository, fixtures};

impl PostgresAuthRepository for StaticPostgresRepository {
    fn find_login_user(
        &self,
        email: &str,
    ) -> BoxFuture<'_, Result<Option<AuthLoginUser>, DataAccessError>> {
        let normalized_email = email.trim().to_ascii_lowercase();
        Box::pin(async move {
            if normalized_email != "admin@example.com" {
                return Ok(None);
            }

            Ok(Some(AuthLoginUser {
                id: String::from("user-1"),
                email: normalized_email,
                password_hash: String::from("fixture-password-hash"),
                password_salt: String::from("fixture-password-salt"),
                admin: true,
            }))
        })
    }

    fn register_user(
        &self,
        input: AuthRegisterInput,
    ) -> BoxFuture<'_, Result<AuthRegisteredUser, DataAccessError>> {
        Box::pin(async move {
            if input.email == "admin@example.com" {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::InvalidInput,
                    "email already registered",
                ));
            }

            Ok(AuthRegisteredUser {
                id: String::from("user-created"),
                email: input.email,
            })
        })
    }

    fn list_user_organizations(
        &self,
        user_id: &str,
    ) -> BoxFuture<'_, Result<AuthUserOrganizations, DataAccessError>> {
        let user_id = user_id.to_string();
        Box::pin(async move {
            let users = fixtures::user_summaries();
            let organizations = fixtures::organization_summaries();
            let Some(user) = users.into_iter().find(|candidate| candidate.id == user_id) else {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::NotFound,
                    format!("user not found: {user_id}"),
                ));
            };

            let payload = organizations
                .into_iter()
                .filter(|organization| {
                    user.organization_ids
                        .iter()
                        .any(|organization_id| organization_id == &organization.id)
                })
                .map(|organization| AuthOrganization {
                    id: organization.id,
                    name: organization.name,
                    is_personal: false,
                })
                .collect::<Vec<_>>();

            let personal_organization_id =
                user.organization_ids.first().cloned().ok_or_else(|| {
                    DataAccessError::new(
                        DataAccessErrorKind::Internal,
                        "user personal organization id not found",
                    )
                })?;

            Ok(AuthUserOrganizations {
                organizations: payload,
                personal_organization_id,
            })
        })
    }
}

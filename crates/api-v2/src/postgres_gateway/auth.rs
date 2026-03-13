use chrono::Utc;
use tokio_postgres::error::SqlState;

use tearleads_data_access_traits::{
    AuthLoginUser, AuthOrganization, AuthRegisterInput, AuthRegisteredUser, AuthUserOrganizations,
    BoxFuture, DataAccessError, DataAccessErrorKind, PostgresAuthRepository,
};

use super::TokioPostgresGateway;
use super::error::{pool_error, query_error};
use super::groups::uuid_v4;

const REVENUECAT_APP_USER_PREFIX: &str = "org:";

impl PostgresAuthRepository for TokioPostgresGateway {
    fn find_login_user(
        &self,
        email: &str,
    ) -> BoxFuture<'_, Result<Option<AuthLoginUser>, DataAccessError>> {
        let email = email.to_string();
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let rows = client
                .query(
                    "SELECT u.id, u.email, u.admin, uc.password_hash, uc.password_salt
                     FROM users u
                     LEFT JOIN user_credentials uc ON u.id = uc.user_id
                     WHERE lower(u.email) = $1
                     LIMIT 1",
                    &[&email],
                )
                .await
                .map_err(query_error)?;

            let Some(row) = rows.into_iter().next() else {
                return Ok(None);
            };

            let Some(password_hash) = row.get::<_, Option<String>>("password_hash") else {
                return Ok(None);
            };
            let Some(password_salt) = row.get::<_, Option<String>>("password_salt") else {
                return Ok(None);
            };

            Ok(Some(AuthLoginUser {
                id: row.get("id"),
                email: row.get("email"),
                password_hash,
                password_salt,
                admin: row.get::<_, Option<bool>>("admin").unwrap_or(false),
            }))
        })
    }

    fn register_user(
        &self,
        input: AuthRegisterInput,
    ) -> BoxFuture<'_, Result<AuthRegisteredUser, DataAccessError>> {
        Box::pin(async move {
            let mut client = self.pool.get().await.map_err(pool_error)?;

            let existing = client
                .query(
                    "SELECT id FROM users WHERE lower(email) = $1 LIMIT 1",
                    &[&input.email],
                )
                .await
                .map_err(query_error)?;
            if !existing.is_empty() {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::InvalidInput,
                    "email already registered",
                ));
            }

            let transaction = client.transaction().await.map_err(query_error)?;
            let user_id = uuid_v4();
            let personal_organization_id = user_id.clone();
            let personal_organization_name = format!("Personal {user_id}");
            let revenuecat_app_user_id =
                format!("{REVENUECAT_APP_USER_PREFIX}{personal_organization_id}");
            let now = Utc::now();

            let result = async {
                transaction
                    .execute(
                        "INSERT INTO organizations (
                            id,
                            name,
                            description,
                            is_personal,
                            created_at,
                            updated_at
                        )
                        VALUES ($1, $2, $3, true, $4, $4)",
                        &[
                            &personal_organization_id,
                            &personal_organization_name,
                            &format!("Personal organization for {}", input.email),
                            &now,
                        ],
                    )
                    .await
                    .map_err(query_error)?;

                transaction
                    .execute(
                        "INSERT INTO users (
                            id,
                            email,
                            email_confirmed,
                            admin,
                            personal_organization_id,
                            created_at,
                            updated_at
                        )
                        VALUES ($1, $2, true, false, $3, $4, $4)",
                        &[&user_id, &input.email, &personal_organization_id, &now],
                    )
                    .await
                    .map_err(query_error)?;

                transaction
                    .execute(
                        "INSERT INTO user_organizations (
                            user_id,
                            organization_id,
                            joined_at,
                            is_admin
                        )
                        VALUES ($1, $2, $3, true)",
                        &[&user_id, &personal_organization_id, &now],
                    )
                    .await
                    .map_err(query_error)?;

                transaction
                    .execute(
                        "INSERT INTO organization_billing_accounts (
                            organization_id,
                            revenuecat_app_user_id,
                            entitlement_status,
                            created_at,
                            updated_at
                        )
                        VALUES ($1, $2, 'inactive', $3, $3)",
                        &[&personal_organization_id, &revenuecat_app_user_id, &now],
                    )
                    .await
                    .map_err(query_error)?;

                transaction
                    .execute(
                        "INSERT INTO user_credentials (
                            user_id,
                            password_hash,
                            password_salt,
                            created_at,
                            updated_at
                        )
                        VALUES ($1, $2, $3, $4, $4)",
                        &[&user_id, &input.password_hash, &input.password_salt, &now],
                    )
                    .await
                    .map_err(query_error)?;

                if let Some(vfs_key_setup) = input.vfs_key_setup {
                    let signing_key = vfs_key_setup.public_signing_key.unwrap_or_default();
                    transaction
                        .execute(
                            "INSERT INTO user_keys (
                                user_id,
                                public_encryption_key,
                                public_signing_key,
                                encrypted_private_keys,
                                argon2_salt,
                                created_at
                            )
                            VALUES ($1, $2, $3, $4, $5, $6)",
                            &[
                                &user_id,
                                &vfs_key_setup.public_encryption_key,
                                &signing_key,
                                &vfs_key_setup.encrypted_private_keys,
                                &vfs_key_setup.argon2_salt,
                                &now,
                            ],
                        )
                        .await
                        .map_err(query_error)?;
                }

                Ok::<(), DataAccessError>(())
            }
            .await;

            if let Err(error) = result {
                transaction.rollback().await.map_err(query_error)?;
                return Err(map_register_error(error));
            }

            transaction.commit().await.map_err(query_error)?;

            Ok(AuthRegisteredUser {
                id: user_id,
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
            let client = self.pool.get().await.map_err(pool_error)?;

            let organization_rows = client
                .query(
                    "SELECT o.id, o.name, o.is_personal
                     FROM user_organizations uo
                     JOIN organizations o ON o.id = uo.organization_id
                     WHERE uo.user_id = $1
                     ORDER BY o.created_at",
                    &[&user_id],
                )
                .await
                .map_err(query_error)?;

            let personal_organization_row = client
                .query(
                    "SELECT personal_organization_id
                     FROM users
                     WHERE id = $1
                     LIMIT 1",
                    &[&user_id],
                )
                .await
                .map_err(query_error)?
                .into_iter()
                .next()
                .and_then(|row| row.get::<_, Option<String>>("personal_organization_id"));

            let Some(personal_organization_id) = personal_organization_row else {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::Internal,
                    "user personal organization id not found",
                ));
            };

            let organizations = organization_rows
                .into_iter()
                .map(|row| AuthOrganization {
                    id: row.get("id"),
                    name: row.get("name"),
                    is_personal: row.get("is_personal"),
                })
                .collect::<Vec<_>>();

            Ok(AuthUserOrganizations {
                organizations,
                personal_organization_id,
            })
        })
    }
}

fn map_register_error(error: DataAccessError) -> DataAccessError {
    if error.kind() != DataAccessErrorKind::Internal {
        return error;
    }

    let is_unique_violation = error.message().contains(SqlState::UNIQUE_VIOLATION.code())
        || error.message().contains("duplicate key value");
    if is_unique_violation {
        return DataAccessError::new(
            DataAccessErrorKind::InvalidInput,
            "email already registered",
        );
    }

    error
}

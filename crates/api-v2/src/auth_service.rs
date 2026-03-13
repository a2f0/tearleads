//! Contract-first auth RPC handlers backed by Postgres + Redis repositories.

mod config;
mod session_store;
mod support;

use tearleads_api_v2_contracts::tearleads::v2::{
    AuthServiceDeleteSessionRequest, AuthServiceDeleteSessionResponse,
    AuthServiceGetOrganizationsRequest, AuthServiceGetOrganizationsResponse,
    AuthServiceGetSessionsRequest, AuthServiceGetSessionsResponse, AuthServiceLoginRequest,
    AuthServiceLoginResponse, AuthServiceLogoutRequest, AuthServiceLogoutResponse,
    AuthServiceRefreshTokenRequest, AuthServiceRefreshTokenResponse, AuthServiceRegisterRequest,
    AuthServiceRegisterResponse, AuthUser, AuthUserOrganization, auth_service_server::AuthService,
};
use tearleads_data_access_traits::{
    AuthCreateSessionInput, AuthRegisterInput, AuthRotateTokensInput, DataAccessError,
    DataAccessErrorKind, PostgresAuthRepository, RedisAuthSessionRepository,
};
use tonic::{Request, Response, Status, metadata::MetadataMap};
use uuid::Uuid;

use self::support::{
    append_set_cookie, build_clear_refresh_cookie, build_refresh_cookie, client_ip_from_metadata,
    create_access_token, create_refresh_token, decode_access_token, decode_refresh_token,
    hash_password, map_auth_session_summary, map_data_access_error, normalize_email,
    normalize_optional_non_empty, normalize_password, normalize_vfs_key_setup, parse_bearer_token,
    refresh_token_from_cookie, saturating_i32, validate_allowed_email_domain,
    validate_registration_password, verify_password,
};
pub use config::AuthServiceConfig;
pub use session_store::RedisAuthSessionStore;

struct AuthAccessContext {
    user_id: String,
    session_id: String,
}

fn is_duplicate_email_registration_error(error: &DataAccessError) -> bool {
    if error.kind() != DataAccessErrorKind::InvalidInput {
        return false;
    }

    let normalized = error.message().trim().to_ascii_lowercase();
    normalized.contains("email already registered")
        || (normalized.contains("duplicate") && normalized.contains("email"))
}

/// Trait-backed implementation of `tearleads.v2.AuthService`.
pub struct AuthServiceHandler<P, R = RedisAuthSessionStore> {
    auth_repo: P,
    session_repo: R,
    config: AuthServiceConfig,
}

impl<P> AuthServiceHandler<P, RedisAuthSessionStore> {
    /// Creates an auth handler using runtime env config and Redis session store.
    pub fn new(auth_repo: P) -> Self {
        Self::with_dependencies(
            auth_repo,
            RedisAuthSessionStore::from_env(),
            AuthServiceConfig::from_env(),
        )
    }
}

impl<P, R> AuthServiceHandler<P, R> {
    /// Creates an auth handler from explicit dependencies.
    pub fn with_dependencies(auth_repo: P, session_repo: R, config: AuthServiceConfig) -> Self {
        Self {
            auth_repo,
            session_repo,
            config,
        }
    }
}

#[tonic::async_trait]
impl<P, R> AuthService for AuthServiceHandler<P, R>
where
    P: PostgresAuthRepository + Send + Sync + 'static,
    R: RedisAuthSessionRepository + Send + Sync + 'static,
{
    async fn login(
        &self,
        request: Request<AuthServiceLoginRequest>,
    ) -> Result<Response<AuthServiceLoginResponse>, Status> {
        let metadata = request.metadata().clone();
        let payload = request.into_inner();
        let email = normalize_email(&payload.email)?;
        let password = normalize_password(&payload.password)?;

        let user = self
            .auth_repo
            .find_login_user(&email)
            .await
            .map_err(map_data_access_error)?
            .ok_or_else(|| Status::unauthenticated("Invalid email or password"))?;
        if !verify_password(&password, &user.password_salt, &user.password_hash)? {
            return Err(Status::unauthenticated("Invalid email or password"));
        }

        let session_id = Uuid::new_v4().to_string();
        let ip_address = client_ip_from_metadata(&metadata);
        self.session_repo
            .create_session(
                &session_id,
                AuthCreateSessionInput {
                    user_id: user.id.clone(),
                    email: user.email.clone(),
                    admin: user.admin,
                    ip_address,
                },
                self.config.refresh_token_ttl_seconds,
            )
            .await
            .map_err(map_data_access_error)?;

        let refresh_token_id = Uuid::new_v4().to_string();
        self.session_repo
            .store_refresh_token(
                &refresh_token_id,
                &session_id,
                &user.id,
                self.config.refresh_token_ttl_seconds,
            )
            .await
            .map_err(map_data_access_error)?;

        let secret = jwt_secret(&self.config)?;
        let access_token = create_access_token(
            secret,
            &user.id,
            &user.email,
            &session_id,
            self.config.access_token_ttl_seconds,
        )?;
        let refresh_token = create_refresh_token(
            secret,
            &user.id,
            &refresh_token_id,
            &session_id,
            self.config.refresh_token_ttl_seconds,
        )?;
        let mut response = Response::new(AuthServiceLoginResponse {
            access_token,
            refresh_token: refresh_token.clone(),
            token_type: String::from("Bearer"),
            expires_in: saturating_i32(self.config.access_token_ttl_seconds),
            refresh_expires_in: saturating_i32(self.config.refresh_token_ttl_seconds),
            user: Some(AuthUser {
                id: user.id,
                email: user.email,
            }),
        });
        append_set_cookie(
            response.metadata_mut(),
            build_refresh_cookie(
                &refresh_token,
                self.config.refresh_token_ttl_seconds,
                self.config.refresh_cookie_secure,
            ),
        )?;
        Ok(response)
    }

    async fn register(
        &self,
        request: Request<AuthServiceRegisterRequest>,
    ) -> Result<Response<AuthServiceRegisterResponse>, Status> {
        let metadata = request.metadata().clone();
        let payload = request.into_inner();
        let email = normalize_email(&payload.email)?;
        let password = normalize_password(&payload.password)?;
        validate_registration_password(&password)?;
        validate_allowed_email_domain(&email, &self.config.allowed_email_domains)?;

        let (password_salt, password_hash) = hash_password(&password)?;
        let created_user = self
            .auth_repo
            .register_user(AuthRegisterInput {
                email: email.clone(),
                password_hash,
                password_salt,
                vfs_key_setup: payload
                    .vfs_key_setup
                    .map(normalize_vfs_key_setup)
                    .transpose()?,
            })
            .await
            .map_err(|error| {
                if is_duplicate_email_registration_error(&error) {
                    Status::already_exists("Email already registered")
                } else {
                    map_data_access_error(error)
                }
            })?;

        let session_id = Uuid::new_v4().to_string();
        self.session_repo
            .create_session(
                &session_id,
                AuthCreateSessionInput {
                    user_id: created_user.id.clone(),
                    email: created_user.email.clone(),
                    admin: false,
                    ip_address: client_ip_from_metadata(&metadata),
                },
                self.config.refresh_token_ttl_seconds,
            )
            .await
            .map_err(map_data_access_error)?;

        let refresh_token_id = Uuid::new_v4().to_string();
        self.session_repo
            .store_refresh_token(
                &refresh_token_id,
                &session_id,
                &created_user.id,
                self.config.refresh_token_ttl_seconds,
            )
            .await
            .map_err(map_data_access_error)?;

        let secret = jwt_secret(&self.config)?;
        let access_token = create_access_token(
            secret,
            &created_user.id,
            &created_user.email,
            &session_id,
            self.config.access_token_ttl_seconds,
        )?;
        let refresh_token = create_refresh_token(
            secret,
            &created_user.id,
            &refresh_token_id,
            &session_id,
            self.config.refresh_token_ttl_seconds,
        )?;

        let mut response = Response::new(AuthServiceRegisterResponse {
            access_token,
            refresh_token: refresh_token.clone(),
            token_type: String::from("Bearer"),
            expires_in: saturating_i32(self.config.access_token_ttl_seconds),
            refresh_expires_in: saturating_i32(self.config.refresh_token_ttl_seconds),
            user: Some(AuthUser {
                id: created_user.id,
                email: created_user.email,
            }),
        });
        append_set_cookie(
            response.metadata_mut(),
            build_refresh_cookie(
                &refresh_token,
                self.config.refresh_token_ttl_seconds,
                self.config.refresh_cookie_secure,
            ),
        )?;
        Ok(response)
    }

    async fn refresh_token(
        &self,
        request: Request<AuthServiceRefreshTokenRequest>,
    ) -> Result<Response<AuthServiceRefreshTokenResponse>, Status> {
        let refresh_token = normalize_optional_non_empty(&request.get_ref().refresh_token)
            .or_else(|| refresh_token_from_cookie(request.metadata()))
            .ok_or_else(|| Status::unauthenticated("Invalid refresh token"))?;

        let secret = jwt_secret(&self.config)?;
        let claims = decode_refresh_token(secret, &refresh_token)?;
        if self
            .session_repo
            .get_refresh_token(&claims.jti)
            .await
            .map_err(map_data_access_error)?
            .is_none()
        {
            return Err(Status::unauthenticated("Refresh token has been revoked"));
        }

        let Some(session) = self
            .session_repo
            .get_session(&claims.sid)
            .await
            .map_err(map_data_access_error)?
        else {
            self.session_repo
                .delete_refresh_token(&claims.jti)
                .await
                .map_err(map_data_access_error)?;
            return Err(Status::unauthenticated("Session no longer valid"));
        };
        if session.user_id != claims.sub {
            self.session_repo
                .delete_refresh_token(&claims.jti)
                .await
                .map_err(map_data_access_error)?;
            return Err(Status::unauthenticated("Session no longer valid"));
        }

        let new_session_id = Uuid::new_v4().to_string();
        let new_refresh_token_id = Uuid::new_v4().to_string();
        self.session_repo
            .rotate_tokens_atomically(AuthRotateTokensInput {
                old_refresh_token_id: claims.jti.clone(),
                old_session_id: claims.sid.clone(),
                new_session_id: new_session_id.clone(),
                new_refresh_token_id: new_refresh_token_id.clone(),
                session_input: AuthCreateSessionInput {
                    user_id: session.user_id.clone(),
                    email: session.email.clone(),
                    admin: session.admin,
                    ip_address: client_ip_from_metadata(request.metadata()),
                },
                session_ttl_seconds: self.config.refresh_token_ttl_seconds,
                refresh_ttl_seconds: self.config.refresh_token_ttl_seconds,
                original_created_at: Some(session.created_at.clone()),
            })
            .await
            .map_err(map_data_access_error)?;

        let access_token = create_access_token(
            secret,
            &session.user_id,
            &session.email,
            &new_session_id,
            self.config.access_token_ttl_seconds,
        )?;
        let new_refresh_token = create_refresh_token(
            secret,
            &session.user_id,
            &new_refresh_token_id,
            &new_session_id,
            self.config.refresh_token_ttl_seconds,
        )?;
        let mut response = Response::new(AuthServiceRefreshTokenResponse {
            access_token,
            refresh_token: new_refresh_token.clone(),
            token_type: String::from("Bearer"),
            expires_in: saturating_i32(self.config.access_token_ttl_seconds),
            refresh_expires_in: saturating_i32(self.config.refresh_token_ttl_seconds),
            user: Some(AuthUser {
                id: session.user_id,
                email: session.email,
            }),
        });
        append_set_cookie(
            response.metadata_mut(),
            build_refresh_cookie(
                &new_refresh_token,
                self.config.refresh_token_ttl_seconds,
                self.config.refresh_cookie_secure,
            ),
        )?;
        Ok(response)
    }

    async fn get_sessions(
        &self,
        request: Request<AuthServiceGetSessionsRequest>,
    ) -> Result<Response<AuthServiceGetSessionsResponse>, Status> {
        let access = self.require_access_context(request.metadata()).await?;
        let sessions = self
            .session_repo
            .get_sessions_by_user_id(&access.user_id)
            .await
            .map_err(map_data_access_error)?
            .into_iter()
            .map(|session| map_auth_session_summary(session, &access.session_id))
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Response::new(AuthServiceGetSessionsResponse { sessions }))
    }

    async fn delete_session(
        &self,
        request: Request<AuthServiceDeleteSessionRequest>,
    ) -> Result<Response<AuthServiceDeleteSessionResponse>, Status> {
        let access = self.require_access_context(request.metadata()).await?;
        let session_id = request.into_inner().session_id.trim().to_string();
        if session_id.is_empty() {
            return Err(Status::invalid_argument("Session ID is required"));
        }
        if session_id == access.session_id {
            return Err(Status::permission_denied("Cannot delete current session"));
        }

        let deleted = self
            .session_repo
            .delete_session(&session_id, &access.user_id)
            .await
            .map_err(map_data_access_error)?;
        if !deleted {
            return Err(Status::not_found("Session not found"));
        }

        Ok(Response::new(AuthServiceDeleteSessionResponse {
            deleted: true,
        }))
    }

    async fn logout(
        &self,
        request: Request<AuthServiceLogoutRequest>,
    ) -> Result<Response<AuthServiceLogoutResponse>, Status> {
        let access = self.require_access_context(request.metadata()).await?;
        self.session_repo
            .delete_session(&access.session_id, &access.user_id)
            .await
            .map_err(map_data_access_error)?;

        let mut response = Response::new(AuthServiceLogoutResponse { logged_out: true });
        append_set_cookie(
            response.metadata_mut(),
            build_clear_refresh_cookie(self.config.refresh_cookie_secure),
        )?;
        Ok(response)
    }

    async fn get_organizations(
        &self,
        request: Request<AuthServiceGetOrganizationsRequest>,
    ) -> Result<Response<AuthServiceGetOrganizationsResponse>, Status> {
        let access = self.require_access_context(request.metadata()).await?;
        let organizations = self
            .auth_repo
            .list_user_organizations(&access.user_id)
            .await
            .map_err(map_data_access_error)?;

        Ok(Response::new(AuthServiceGetOrganizationsResponse {
            organizations: organizations
                .organizations
                .into_iter()
                .map(|organization| AuthUserOrganization {
                    id: organization.id,
                    name: organization.name,
                    is_personal: organization.is_personal,
                })
                .collect(),
            personal_organization_id: organizations.personal_organization_id,
        }))
    }
}

impl<P, R> AuthServiceHandler<P, R>
where
    R: RedisAuthSessionRepository,
{
    async fn require_access_context(
        &self,
        metadata: &MetadataMap,
    ) -> Result<AuthAccessContext, Status> {
        let token = parse_bearer_token(metadata)?;
        let claims = decode_access_token(jwt_secret(&self.config)?, &token)?;
        let Some(session) = self
            .session_repo
            .get_session(&claims.jti)
            .await
            .map_err(map_data_access_error)?
        else {
            return Err(Status::unauthenticated("Unauthorized"));
        };
        if session.user_id != claims.sub {
            return Err(Status::unauthenticated("Unauthorized"));
        }

        Ok(AuthAccessContext {
            user_id: claims.sub,
            session_id: claims.jti,
        })
    }
}

fn jwt_secret(config: &AuthServiceConfig) -> Result<&str, Status> {
    config
        .jwt_secret
        .as_deref()
        .ok_or_else(|| Status::internal("Failed to authenticate"))
}

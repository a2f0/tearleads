//! Integration coverage for native `AuthService` handler behavior.
#![allow(clippy::expect_used)]

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::Engine as _;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use scrypt::{Params as ScryptParams, scrypt};
use serde::Serialize;
use tearleads_api_v2::{AuthServiceConfig, AuthServiceHandler};
use tearleads_api_v2_contracts::tearleads::v2::{
    AuthServiceDeleteSessionRequest, AuthServiceGetOrganizationsRequest,
    AuthServiceGetSessionsRequest, AuthServiceLoginRequest, auth_service_server::AuthService,
};
use tearleads_data_access_traits::{
    AuthCreateSessionInput, AuthLoginUser, AuthOrganization, AuthRefreshToken, AuthRegisterInput,
    AuthRegisteredUser, AuthRotateTokensInput, AuthSession, AuthUserOrganizations, BoxFuture,
    DataAccessError, DataAccessErrorKind, PostgresAuthRepository, RedisAuthSessionRepository,
};
use tonic::{Code, Request, metadata::MetadataValue};

#[derive(Clone)]
struct FakeAuthRepo {
    login_user: Option<AuthLoginUser>,
    organizations: Vec<AuthOrganization>,
    personal_organization_id: String,
}

impl PostgresAuthRepository for FakeAuthRepo {
    fn find_login_user(
        &self,
        email: &str,
    ) -> BoxFuture<'_, Result<Option<AuthLoginUser>, DataAccessError>> {
        let email = email.to_string();
        let login_user = self.login_user.clone();
        Box::pin(async move {
            Ok(login_user.and_then(|user| {
                if user.email == email {
                    Some(user)
                } else {
                    None
                }
            }))
        })
    }

    fn register_user(
        &self,
        input: AuthRegisterInput,
    ) -> BoxFuture<'_, Result<AuthRegisteredUser, DataAccessError>> {
        Box::pin(async move {
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
        let organizations = self.organizations.clone();
        let personal_organization_id = self.personal_organization_id.clone();
        Box::pin(async move {
            if user_id != "user-1" {
                return Err(DataAccessError::new(
                    DataAccessErrorKind::NotFound,
                    "user not found",
                ));
            }
            Ok(AuthUserOrganizations {
                organizations,
                personal_organization_id,
            })
        })
    }
}

#[derive(Clone, Default)]
struct FakeSessionRepo {
    state: Arc<Mutex<SessionState>>,
}

#[derive(Default)]
struct SessionState {
    sessions: BTreeMap<String, AuthSession>,
    refresh_tokens: BTreeMap<String, AuthRefreshToken>,
}

impl FakeSessionRepo {
    fn insert_session(&self, session: AuthSession) {
        self.state
            .lock()
            .expect("session mutex should lock")
            .sessions
            .insert(session.id.clone(), session);
    }

    fn session_count(&self) -> usize {
        self.state
            .lock()
            .expect("session mutex should lock")
            .sessions
            .len()
    }

    fn refresh_token_count(&self) -> usize {
        self.state
            .lock()
            .expect("session mutex should lock")
            .refresh_tokens
            .len()
    }
}

impl RedisAuthSessionRepository for FakeSessionRepo {
    fn create_session(
        &self,
        session_id: &str,
        input: AuthCreateSessionInput,
        _ttl_seconds: u64,
    ) -> BoxFuture<'_, Result<(), DataAccessError>> {
        let session_id = session_id.to_string();
        let state = self.state.clone();
        Box::pin(async move {
            let now = "2026-03-13T12:00:00Z".to_string();
            state
                .lock()
                .expect("session mutex should lock")
                .sessions
                .insert(
                    session_id.clone(),
                    AuthSession {
                        id: session_id,
                        user_id: input.user_id,
                        email: input.email,
                        admin: input.admin,
                        created_at: now.clone(),
                        last_active_at: now,
                        ip_address: input.ip_address,
                    },
                );
            Ok(())
        })
    }

    fn get_session(
        &self,
        session_id: &str,
    ) -> BoxFuture<'_, Result<Option<AuthSession>, DataAccessError>> {
        let session_id = session_id.to_string();
        let state = self.state.clone();
        Box::pin(async move {
            Ok(state
                .lock()
                .expect("session mutex should lock")
                .sessions
                .get(&session_id)
                .cloned())
        })
    }

    fn get_sessions_by_user_id(
        &self,
        user_id: &str,
    ) -> BoxFuture<'_, Result<Vec<AuthSession>, DataAccessError>> {
        let user_id = user_id.to_string();
        let state = self.state.clone();
        Box::pin(async move {
            Ok(state
                .lock()
                .expect("session mutex should lock")
                .sessions
                .values()
                .filter(|session| session.user_id == user_id)
                .cloned()
                .collect())
        })
    }

    fn delete_session(
        &self,
        session_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let session_id = session_id.to_string();
        let user_id = user_id.to_string();
        let state = self.state.clone();
        Box::pin(async move {
            let mut state = state.lock().expect("session mutex should lock");
            let Some(session) = state.sessions.get(&session_id) else {
                return Ok(false);
            };
            if session.user_id != user_id {
                return Ok(false);
            }
            state.sessions.remove(&session_id);
            Ok(true)
        })
    }

    fn store_refresh_token(
        &self,
        token_id: &str,
        session_id: &str,
        user_id: &str,
        _ttl_seconds: u64,
    ) -> BoxFuture<'_, Result<(), DataAccessError>> {
        let token_id = token_id.to_string();
        let session_id = session_id.to_string();
        let user_id = user_id.to_string();
        let state = self.state.clone();
        Box::pin(async move {
            state
                .lock()
                .expect("session mutex should lock")
                .refresh_tokens
                .insert(
                    token_id.clone(),
                    AuthRefreshToken {
                        id: token_id,
                        session_id,
                        user_id,
                        created_at: "2026-03-13T12:00:00Z".to_string(),
                    },
                );
            Ok(())
        })
    }

    fn get_refresh_token(
        &self,
        token_id: &str,
    ) -> BoxFuture<'_, Result<Option<AuthRefreshToken>, DataAccessError>> {
        let token_id = token_id.to_string();
        let state = self.state.clone();
        Box::pin(async move {
            Ok(state
                .lock()
                .expect("session mutex should lock")
                .refresh_tokens
                .get(&token_id)
                .cloned())
        })
    }

    fn delete_refresh_token(&self, token_id: &str) -> BoxFuture<'_, Result<(), DataAccessError>> {
        let token_id = token_id.to_string();
        let state = self.state.clone();
        Box::pin(async move {
            state
                .lock()
                .expect("session mutex should lock")
                .refresh_tokens
                .remove(&token_id);
            Ok(())
        })
    }

    fn rotate_tokens_atomically(
        &self,
        input: AuthRotateTokensInput,
    ) -> BoxFuture<'_, Result<(), DataAccessError>> {
        let state = self.state.clone();
        Box::pin(async move {
            let mut state = state.lock().expect("session mutex should lock");
            state.refresh_tokens.remove(&input.old_refresh_token_id);
            state.sessions.remove(&input.old_session_id);
            state.sessions.insert(
                input.new_session_id.clone(),
                AuthSession {
                    id: input.new_session_id.clone(),
                    user_id: input.session_input.user_id.clone(),
                    email: input.session_input.email,
                    admin: input.session_input.admin,
                    created_at: input
                        .original_created_at
                        .unwrap_or_else(|| "2026-03-13T12:00:00Z".to_string()),
                    last_active_at: "2026-03-13T12:00:01Z".to_string(),
                    ip_address: input.session_input.ip_address,
                },
            );
            state.refresh_tokens.insert(
                input.new_refresh_token_id.clone(),
                AuthRefreshToken {
                    id: input.new_refresh_token_id,
                    session_id: input.new_session_id,
                    user_id: input.session_input.user_id,
                    created_at: "2026-03-13T12:00:01Z".to_string(),
                },
            );
            Ok(())
        })
    }
}

#[derive(Serialize)]
struct AccessTokenClaims {
    sub: String,
    email: String,
    jti: String,
    exp: usize,
}

fn create_access_token(secret: &str, user_id: &str, session_id: &str) -> String {
    let expires = SystemTime::now()
        .checked_add(Duration::from_secs(3600))
        .expect("duration math should succeed")
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_secs() as usize;
    jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &AccessTokenClaims {
            sub: user_id.to_string(),
            email: format!("{user_id}@example.com"),
            jti: session_id.to_string(),
            exp: expires,
        },
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .expect("access token encoding should succeed")
}

fn hash_fixture_password(password: &str, salt: &str) -> String {
    let mut output = [0_u8; 64];
    let params =
        ScryptParams::new(14, 8, 1, output.len()).expect("fixture scrypt params should be valid");
    scrypt(password.as_bytes(), salt.as_bytes(), &params, &mut output)
        .expect("fixture scrypt derivation should succeed");
    base64::engine::general_purpose::STANDARD.encode(output)
}

fn build_config(secret: &str) -> AuthServiceConfig {
    AuthServiceConfig::with_values(Some(secret.to_string()), 3600, 86400, Vec::new(), false)
}

#[tokio::test]
async fn login_success_sets_cookie_and_persists_session() {
    let secret = "test-secret";
    let salt = "fixture-salt";
    let repo = FakeAuthRepo {
        login_user: Some(AuthLoginUser {
            id: "user-1".to_string(),
            email: "user-1@example.com".to_string(),
            password_hash: hash_fixture_password("Password!123", salt),
            password_salt: salt.to_string(),
            admin: false,
        }),
        organizations: Vec::new(),
        personal_organization_id: "org-1".to_string(),
    };
    let sessions = FakeSessionRepo::default();
    let handler =
        AuthServiceHandler::with_dependencies(repo, sessions.clone(), build_config(secret));

    let request = Request::new(AuthServiceLoginRequest {
        email: "user-1@example.com".to_string(),
        password: "Password!123".to_string(),
    });

    let response = handler.login(request).await.expect("login should succeed");
    let payload = response.into_inner();
    assert_eq!(
        payload.user.expect("user payload should exist").id,
        "user-1"
    );
    assert!(!payload.refresh_token.is_empty());
    assert_eq!(sessions.session_count(), 1);
    assert_eq!(sessions.refresh_token_count(), 1);
}

#[tokio::test]
async fn get_sessions_rejects_missing_authorization() {
    let handler = AuthServiceHandler::with_dependencies(
        FakeAuthRepo {
            login_user: None,
            organizations: Vec::new(),
            personal_organization_id: "org-1".to_string(),
        },
        FakeSessionRepo::default(),
        build_config("test-secret"),
    );

    let error = handler
        .get_sessions(Request::new(AuthServiceGetSessionsRequest {}))
        .await
        .expect_err("missing auth should fail");
    assert_eq!(error.code(), Code::Unauthenticated);
}

#[tokio::test]
async fn get_organizations_returns_repo_payload() {
    let secret = "test-secret";
    let session_id = "session-1";
    let sessions = FakeSessionRepo::default();
    sessions.insert_session(AuthSession {
        id: session_id.to_string(),
        user_id: "user-1".to_string(),
        email: "user-1@example.com".to_string(),
        admin: false,
        created_at: "2026-03-13T12:00:00Z".to_string(),
        last_active_at: "2026-03-13T12:00:00Z".to_string(),
        ip_address: "127.0.0.1".to_string(),
    });

    let handler = AuthServiceHandler::with_dependencies(
        FakeAuthRepo {
            login_user: None,
            organizations: vec![AuthOrganization {
                id: "org-1".to_string(),
                name: "Organization 1".to_string(),
                is_personal: true,
            }],
            personal_organization_id: "org-1".to_string(),
        },
        sessions,
        build_config(secret),
    );

    let token = create_access_token(secret, "user-1", session_id);
    let mut request = Request::new(AuthServiceGetOrganizationsRequest {});
    request.metadata_mut().insert(
        "authorization",
        MetadataValue::try_from(format!("Bearer {token}"))
            .expect("metadata authorization value should be valid"),
    );

    let response = handler
        .get_organizations(request)
        .await
        .expect("authorized call should succeed")
        .into_inner();
    assert_eq!(response.organizations.len(), 1);
    assert_eq!(response.personal_organization_id, "org-1");
}

#[tokio::test]
async fn delete_session_rejects_current_session() {
    let secret = "test-secret";
    let session_id = "session-current";
    let sessions = FakeSessionRepo::default();
    sessions.insert_session(AuthSession {
        id: session_id.to_string(),
        user_id: "user-1".to_string(),
        email: "user-1@example.com".to_string(),
        admin: false,
        created_at: "2026-03-13T12:00:00Z".to_string(),
        last_active_at: "2026-03-13T12:00:00Z".to_string(),
        ip_address: "127.0.0.1".to_string(),
    });

    let handler = AuthServiceHandler::with_dependencies(
        FakeAuthRepo {
            login_user: None,
            organizations: Vec::new(),
            personal_organization_id: "org-1".to_string(),
        },
        sessions,
        build_config(secret),
    );

    let token = create_access_token(secret, "user-1", session_id);
    let mut request = Request::new(AuthServiceDeleteSessionRequest {
        session_id: session_id.to_string(),
    });
    request.metadata_mut().insert(
        "authorization",
        MetadataValue::try_from(format!("Bearer {token}"))
            .expect("metadata authorization value should be valid"),
    );

    let error = handler
        .delete_session(request)
        .await
        .expect_err("current session delete should fail");
    assert_eq!(error.code(), Code::PermissionDenied);
}

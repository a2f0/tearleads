//! Additional integration coverage for native `AuthService` branches.
#![allow(clippy::expect_used)]

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use jsonwebtoken::{Algorithm, EncodingKey, Header};
use serde::Serialize;
use tearleads_api_v2::{AuthServiceConfig, AuthServiceHandler};
use tearleads_api_v2_contracts::tearleads::v2::{
    AuthServiceLoginRequest, AuthServiceRefreshTokenRequest, AuthServiceRegisterRequest,
    auth_service_server::AuthService,
};
use tearleads_data_access_traits::{
    AuthCreateSessionInput, AuthLoginUser, AuthOrganization, AuthRefreshToken, AuthRegisterInput,
    AuthRegisteredUser, AuthRotateTokensInput, AuthSession, AuthUserOrganizations, BoxFuture,
    DataAccessError, DataAccessErrorKind, PostgresAuthRepository, RedisAuthSessionRepository,
};
use tonic::{Code, Request, metadata::MetadataValue};

#[derive(Clone)]
struct ConfigurableAuthRepo {
    login_user: Option<AuthLoginUser>,
    register_outcome: Result<AuthRegisteredUser, DataAccessError>,
    organizations_outcome: Result<AuthUserOrganizations, DataAccessError>,
}

impl PostgresAuthRepository for ConfigurableAuthRepo {
    fn find_login_user(
        &self,
        _email: &str,
    ) -> BoxFuture<'_, Result<Option<AuthLoginUser>, DataAccessError>> {
        let user = self.login_user.clone();
        Box::pin(async move { Ok(user) })
    }

    fn register_user(
        &self,
        _input: AuthRegisterInput,
    ) -> BoxFuture<'_, Result<AuthRegisteredUser, DataAccessError>> {
        let result = self.register_outcome.clone();
        Box::pin(async move { result })
    }

    fn list_user_organizations(
        &self,
        _user_id: &str,
    ) -> BoxFuture<'_, Result<AuthUserOrganizations, DataAccessError>> {
        let result = self.organizations_outcome.clone();
        Box::pin(async move { result })
    }
}

#[derive(Clone, Default)]
struct SessionRepo {
    state: Arc<Mutex<SessionState>>,
}

#[derive(Default)]
struct SessionState {
    sessions: BTreeMap<String, AuthSession>,
    refresh_tokens: BTreeMap<String, AuthRefreshToken>,
}

impl SessionRepo {
    fn insert_session(&self, session: AuthSession) {
        self.state
            .lock()
            .expect("session mutex should lock")
            .sessions
            .insert(session.id.clone(), session);
    }

    fn insert_refresh_token(&self, token: AuthRefreshToken) {
        self.state
            .lock()
            .expect("session mutex should lock")
            .refresh_tokens
            .insert(token.id.clone(), token);
    }
}

impl RedisAuthSessionRepository for SessionRepo {
    fn create_session(
        &self,
        session_id: &str,
        input: AuthCreateSessionInput,
        _ttl_seconds: u64,
    ) -> BoxFuture<'_, Result<(), DataAccessError>> {
        let session_id = session_id.to_string();
        let state = self.state.clone();
        Box::pin(async move {
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
                        created_at: "2026-03-13T12:00:00Z".to_string(),
                        last_active_at: "2026-03-13T12:00:00Z".to_string(),
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
            state.sessions.remove(&input.old_session_id);
            state.refresh_tokens.remove(&input.old_refresh_token_id);
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
struct RefreshClaims {
    sub: String,
    jti: String,
    sid: String,
    #[serde(rename = "type")]
    token_type: String,
    exp: usize,
}

fn build_config(secret: &str) -> AuthServiceConfig {
    AuthServiceConfig::with_values(Some(secret.to_string()), 3600, 86400, Vec::new(), false)
}

fn expiry() -> usize {
    SystemTime::now()
        .checked_add(Duration::from_secs(3600))
        .expect("duration should add")
        .duration_since(UNIX_EPOCH)
        .expect("time should be after epoch")
        .as_secs() as usize
}

fn create_refresh_token(secret: &str, user_id: &str, refresh_id: &str, session_id: &str) -> String {
    jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &RefreshClaims {
            sub: user_id.to_string(),
            jti: refresh_id.to_string(),
            sid: session_id.to_string(),
            token_type: "refresh".to_string(),
            exp: expiry(),
        },
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .expect("refresh token should encode")
}

#[tokio::test]
async fn login_rejects_missing_user() {
    let handler = AuthServiceHandler::with_dependencies(
        ConfigurableAuthRepo {
            login_user: None,
            register_outcome: Ok(AuthRegisteredUser {
                id: "user-created".to_string(),
                email: "new@example.com".to_string(),
            }),
            organizations_outcome: Ok(AuthUserOrganizations {
                organizations: vec![],
                personal_organization_id: "org-1".to_string(),
            }),
        },
        SessionRepo::default(),
        build_config("secret"),
    );

    let error = handler
        .login(Request::new(AuthServiceLoginRequest {
            email: "missing@example.com".to_string(),
            password: "Password!123".to_string(),
        }))
        .await
        .expect_err("missing user should fail");
    assert_eq!(error.code(), Code::Unauthenticated);
}

#[tokio::test]
async fn register_maps_duplicate_email_and_success_paths() {
    let duplicate_handler = AuthServiceHandler::with_dependencies(
        ConfigurableAuthRepo {
            login_user: None,
            register_outcome: Err(DataAccessError::new(
                DataAccessErrorKind::InvalidInput,
                "email already registered",
            )),
            organizations_outcome: Ok(AuthUserOrganizations {
                organizations: vec![],
                personal_organization_id: "org-1".to_string(),
            }),
        },
        SessionRepo::default(),
        build_config("secret"),
    );

    let duplicate = duplicate_handler
        .register(Request::new(AuthServiceRegisterRequest {
            email: "user@example.com".to_string(),
            password: "Password!123".to_string(),
            vfs_key_setup: None,
        }))
        .await
        .expect_err("duplicate email should fail");
    assert_eq!(duplicate.code(), Code::AlreadyExists);

    let internal_handler = AuthServiceHandler::with_dependencies(
        ConfigurableAuthRepo {
            login_user: None,
            register_outcome: Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "db down",
            )),
            organizations_outcome: Ok(AuthUserOrganizations {
                organizations: vec![],
                personal_organization_id: "org-1".to_string(),
            }),
        },
        SessionRepo::default(),
        build_config("secret"),
    );
    let internal = internal_handler
        .register(Request::new(AuthServiceRegisterRequest {
            email: "user@example.com".to_string(),
            password: "Password!123".to_string(),
            vfs_key_setup: None,
        }))
        .await
        .expect_err("internal register failures should map");
    assert_eq!(internal.code(), Code::Internal);

    let success_handler = AuthServiceHandler::with_dependencies(
        ConfigurableAuthRepo {
            login_user: None,
            register_outcome: Ok(AuthRegisteredUser {
                id: "user-created".to_string(),
                email: "user@example.com".to_string(),
            }),
            organizations_outcome: Ok(AuthUserOrganizations {
                organizations: vec![],
                personal_organization_id: "org-1".to_string(),
            }),
        },
        SessionRepo::default(),
        build_config("secret"),
    );

    let payload = success_handler
        .register(Request::new(AuthServiceRegisterRequest {
            email: "user@example.com".to_string(),
            password: "Password!123".to_string(),
            vfs_key_setup: None,
        }))
        .await
        .expect("register should succeed")
        .into_inner();
    assert_eq!(
        payload.user.expect("user payload should exist").id,
        "user-created"
    );
}

#[tokio::test]
async fn refresh_token_uses_cookie_and_rejects_missing_token() {
    let secret = "secret";
    let repo = ConfigurableAuthRepo {
        login_user: None,
        register_outcome: Ok(AuthRegisteredUser {
            id: "user-created".to_string(),
            email: "user@example.com".to_string(),
        }),
        organizations_outcome: Ok(AuthUserOrganizations {
            organizations: vec![AuthOrganization {
                id: "org-1".to_string(),
                name: "Org 1".to_string(),
                is_personal: true,
            }],
            personal_organization_id: "org-1".to_string(),
        }),
    };
    let sessions = SessionRepo::default();
    sessions.insert_session(AuthSession {
        id: "session-old".to_string(),
        user_id: "user-1".to_string(),
        email: "user-1@example.com".to_string(),
        admin: false,
        created_at: "2026-03-13T12:00:00Z".to_string(),
        last_active_at: "2026-03-13T12:00:00Z".to_string(),
        ip_address: "127.0.0.1".to_string(),
    });
    sessions.insert_refresh_token(AuthRefreshToken {
        id: "refresh-old".to_string(),
        session_id: "session-old".to_string(),
        user_id: "user-1".to_string(),
        created_at: "2026-03-13T12:00:00Z".to_string(),
    });

    let handler = AuthServiceHandler::with_dependencies(repo, sessions, build_config(secret));

    let refresh = create_refresh_token(secret, "user-1", "refresh-old", "session-old");
    let mut request = Request::new(AuthServiceRefreshTokenRequest {
        refresh_token: String::new(),
    });
    request.metadata_mut().insert(
        "cookie",
        MetadataValue::try_from(format!("tearleads_refresh_token={refresh}"))
            .expect("cookie value should be valid"),
    );

    let payload = handler
        .refresh_token(request)
        .await
        .expect("refresh from cookie should succeed")
        .into_inner();
    assert!(!payload.refresh_token.is_empty());

    let missing = handler
        .refresh_token(Request::new(AuthServiceRefreshTokenRequest {
            refresh_token: String::new(),
        }))
        .await
        .expect_err("missing refresh token should fail");
    assert_eq!(missing.code(), Code::Unauthenticated);
}

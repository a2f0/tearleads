//! Access-context focused integration coverage for AuthService.
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
    AuthServiceGetSessionsRequest, AuthServiceLogoutRequest, auth_service_server::AuthService,
};
use tearleads_data_access_traits::{
    AuthCreateSessionInput, AuthLoginUser, AuthRefreshToken, AuthRegisterInput, AuthRegisteredUser,
    AuthRotateTokensInput, AuthSession, AuthUserOrganizations, BoxFuture, DataAccessError,
    DataAccessErrorKind, PostgresAuthRepository, RedisAuthSessionRepository,
};
use tonic::{Code, Request, metadata::MetadataValue};

#[derive(Clone)]
struct NoopAuthRepo;

impl PostgresAuthRepository for NoopAuthRepo {
    fn find_login_user(
        &self,
        _email: &str,
    ) -> BoxFuture<'_, Result<Option<AuthLoginUser>, DataAccessError>> {
        Box::pin(async { Ok(None) })
    }

    fn register_user(
        &self,
        _input: AuthRegisterInput,
    ) -> BoxFuture<'_, Result<AuthRegisteredUser, DataAccessError>> {
        Box::pin(async {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "unused in this test",
            ))
        })
    }

    fn list_user_organizations(
        &self,
        _user_id: &str,
    ) -> BoxFuture<'_, Result<AuthUserOrganizations, DataAccessError>> {
        Box::pin(async {
            Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "unused in this test",
            ))
        })
    }
}

#[derive(Clone, Default)]
struct SessionRepo {
    state: Arc<Mutex<BTreeMap<String, AuthSession>>>,
}

impl SessionRepo {
    fn insert(&self, session: AuthSession) {
        self.state
            .lock()
            .expect("session mutex should lock")
            .insert(session.id.clone(), session);
    }
}

impl RedisAuthSessionRepository for SessionRepo {
    fn create_session(
        &self,
        _session_id: &str,
        _input: AuthCreateSessionInput,
        _ttl_seconds: u64,
    ) -> BoxFuture<'_, Result<(), DataAccessError>> {
        Box::pin(async { Ok(()) })
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
            let Some(session) = state.get(&session_id) else {
                return Ok(false);
            };
            if session.user_id != user_id {
                return Ok(false);
            }
            state.remove(&session_id);
            Ok(true)
        })
    }

    fn store_refresh_token(
        &self,
        _token_id: &str,
        _session_id: &str,
        _user_id: &str,
        _ttl_seconds: u64,
    ) -> BoxFuture<'_, Result<(), DataAccessError>> {
        Box::pin(async { Ok(()) })
    }

    fn get_refresh_token(
        &self,
        _token_id: &str,
    ) -> BoxFuture<'_, Result<Option<AuthRefreshToken>, DataAccessError>> {
        Box::pin(async { Ok(None) })
    }

    fn delete_refresh_token(&self, _token_id: &str) -> BoxFuture<'_, Result<(), DataAccessError>> {
        Box::pin(async { Ok(()) })
    }

    fn rotate_tokens_atomically(
        &self,
        _input: AuthRotateTokensInput,
    ) -> BoxFuture<'_, Result<(), DataAccessError>> {
        Box::pin(async { Ok(()) })
    }
}

#[derive(Serialize)]
struct AccessClaims {
    sub: String,
    email: String,
    jti: String,
    exp: usize,
}

fn expiry() -> usize {
    SystemTime::now()
        .checked_add(Duration::from_secs(3600))
        .expect("duration should add")
        .duration_since(UNIX_EPOCH)
        .expect("time should be after epoch")
        .as_secs() as usize
}

fn create_access_token(secret: &str, user_id: &str, session_id: &str) -> String {
    jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &AccessClaims {
            sub: user_id.to_string(),
            email: format!("{user_id}@example.com"),
            jti: session_id.to_string(),
            exp: expiry(),
        },
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .expect("access token should encode")
}

fn handler_with_sessions(
    secret: &str,
    sessions: SessionRepo,
) -> AuthServiceHandler<NoopAuthRepo, SessionRepo> {
    AuthServiceHandler::with_dependencies(
        NoopAuthRepo,
        sessions,
        AuthServiceConfig::with_values(Some(secret.to_string()), 3600, 86400, Vec::new(), false),
    )
}

fn handler_without_secret(sessions: SessionRepo) -> AuthServiceHandler<NoopAuthRepo, SessionRepo> {
    AuthServiceHandler::with_dependencies(
        NoopAuthRepo,
        sessions,
        AuthServiceConfig::with_values(None, 3600, 86400, Vec::new(), false),
    )
}

#[tokio::test]
async fn logout_succeeds_and_get_sessions_maps_valid_sessions() {
    let secret = "secret";
    let sessions = SessionRepo::default();
    sessions.insert(AuthSession {
        id: "session-1".to_string(),
        user_id: "user-1".to_string(),
        email: "user-1@example.com".to_string(),
        admin: true,
        created_at: "2026-03-13T12:00:00Z".to_string(),
        last_active_at: "2026-03-13T12:00:01Z".to_string(),
        ip_address: "127.0.0.1".to_string(),
    });
    let handler = handler_with_sessions(secret, sessions.clone());

    let token = create_access_token(secret, "user-1", "session-1");
    let mut get_request = Request::new(AuthServiceGetSessionsRequest {});
    get_request.metadata_mut().insert(
        "authorization",
        MetadataValue::try_from(format!("Bearer {token}")).expect("auth metadata should parse"),
    );
    let payload = handler
        .get_sessions(get_request)
        .await
        .expect("get sessions should succeed")
        .into_inner();
    assert_eq!(payload.sessions.len(), 1);
    assert!(payload.sessions[0].is_current);

    let mut logout_request = Request::new(AuthServiceLogoutRequest {});
    logout_request.metadata_mut().insert(
        "authorization",
        MetadataValue::try_from(format!("Bearer {token}")).expect("auth metadata should parse"),
    );
    let logout = handler
        .logout(logout_request)
        .await
        .expect("logout should succeed")
        .into_inner();
    assert!(logout.logged_out);
}

#[tokio::test]
async fn get_sessions_rejects_missing_session_and_user_mismatch() {
    let secret = "secret";

    let missing_handler = handler_with_sessions(secret, SessionRepo::default());
    let missing_token = create_access_token(secret, "user-1", "session-missing");
    let mut missing_request = Request::new(AuthServiceGetSessionsRequest {});
    missing_request.metadata_mut().insert(
        "authorization",
        MetadataValue::try_from(format!("Bearer {missing_token}"))
            .expect("auth metadata should parse"),
    );
    let missing = missing_handler
        .get_sessions(missing_request)
        .await
        .expect_err("missing session should fail");
    assert_eq!(missing.code(), Code::Unauthenticated);

    let mismatch_sessions = SessionRepo::default();
    mismatch_sessions.insert(AuthSession {
        id: "session-2".to_string(),
        user_id: "user-2".to_string(),
        email: "user-2@example.com".to_string(),
        admin: false,
        created_at: "2026-03-13T12:00:00Z".to_string(),
        last_active_at: "2026-03-13T12:00:01Z".to_string(),
        ip_address: "127.0.0.1".to_string(),
    });
    let mismatch_handler = handler_with_sessions(secret, mismatch_sessions);
    let mismatch_token = create_access_token(secret, "user-1", "session-2");
    let mut mismatch_request = Request::new(AuthServiceGetSessionsRequest {});
    mismatch_request.metadata_mut().insert(
        "authorization",
        MetadataValue::try_from(format!("Bearer {mismatch_token}"))
            .expect("auth metadata should parse"),
    );
    let mismatch = mismatch_handler
        .get_sessions(mismatch_request)
        .await
        .expect_err("mismatched user/session should fail");
    assert_eq!(mismatch.code(), Code::Unauthenticated);
}

#[tokio::test]
async fn get_sessions_rejects_when_jwt_secret_is_missing() {
    let handler = handler_without_secret(SessionRepo::default());
    let mut request = Request::new(AuthServiceGetSessionsRequest {});
    request.metadata_mut().insert(
        "authorization",
        MetadataValue::try_from("Bearer header.payload.signature")
            .expect("auth metadata should parse"),
    );

    let status = handler
        .get_sessions(request)
        .await
        .expect_err("missing jwt secret should fail");
    assert_eq!(status.code(), Code::Internal);
}

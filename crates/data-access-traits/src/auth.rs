//! Auth read/write models and repository boundaries.

use crate::{BoxFuture, DataAccessError};

/// User row returned for login credential checks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthLoginUser {
    /// User identifier.
    pub id: String,
    /// Canonical user email.
    pub email: String,
    /// Password hash.
    pub password_hash: String,
    /// Password salt.
    pub password_salt: String,
    /// Admin flag.
    pub admin: bool,
}

/// Optional VFS key payload for register flows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthVfsKeySetupInput {
    /// Public encryption key.
    pub public_encryption_key: String,
    /// Optional public signing key.
    pub public_signing_key: Option<String>,
    /// Encrypted private keys blob.
    pub encrypted_private_keys: String,
    /// Argon2 salt.
    pub argon2_salt: String,
}

/// Register input for creating user + personal org atomically.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthRegisterInput {
    /// Canonical email.
    pub email: String,
    /// Password hash.
    pub password_hash: String,
    /// Password salt.
    pub password_salt: String,
    /// Optional VFS key setup payload.
    pub vfs_key_setup: Option<AuthVfsKeySetupInput>,
}

/// Created user payload returned by register storage operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthRegisteredUser {
    /// User identifier.
    pub id: String,
    /// Canonical email.
    pub email: String,
}

/// Organization payload returned by auth organization reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthOrganization {
    /// Organization identifier.
    pub id: String,
    /// Organization display name.
    pub name: String,
    /// Personal-organization marker.
    pub is_personal: bool,
}

/// Organizations payload returned for one authenticated user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthUserOrganizations {
    /// Organizations visible to the authenticated user.
    pub organizations: Vec<AuthOrganization>,
    /// The user's personal organization identifier.
    pub personal_organization_id: String,
}

/// Session row stored in Redis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthSession {
    /// Session identifier.
    pub id: String,
    /// User identifier.
    pub user_id: String,
    /// User email at session creation time.
    pub email: String,
    /// Session admin flag.
    pub admin: bool,
    /// RFC3339 creation timestamp.
    pub created_at: String,
    /// RFC3339 last-active timestamp.
    pub last_active_at: String,
    /// Client IP address.
    pub ip_address: String,
}

/// Refresh token row stored in Redis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthRefreshToken {
    /// Refresh token identifier.
    pub id: String,
    /// Session identifier.
    pub session_id: String,
    /// User identifier.
    pub user_id: String,
    /// RFC3339 creation timestamp.
    pub created_at: String,
}

/// Input for creating a session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthCreateSessionInput {
    /// User identifier.
    pub user_id: String,
    /// User email.
    pub email: String,
    /// Admin flag.
    pub admin: bool,
    /// Client IP address.
    pub ip_address: String,
}

/// Input payload for atomically rotating refresh token + session rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthRotateTokensInput {
    /// Refresh token id to revoke.
    pub old_refresh_token_id: String,
    /// Session id to revoke.
    pub old_session_id: String,
    /// New session id to create.
    pub new_session_id: String,
    /// New refresh token id to create.
    pub new_refresh_token_id: String,
    /// Session payload for the replacement session.
    pub session_input: AuthCreateSessionInput,
    /// TTL applied to the replacement session.
    pub session_ttl_seconds: u64,
    /// TTL applied to the replacement refresh token.
    pub refresh_ttl_seconds: u64,
    /// Optional original session creation timestamp to retain.
    pub original_created_at: Option<String>,
}

/// Repository boundary for auth-related Postgres operations.
pub trait PostgresAuthRepository: Send + Sync {
    /// Returns user credentials payload for login by normalized email.
    fn find_login_user(
        &self,
        email: &str,
    ) -> BoxFuture<'_, Result<Option<AuthLoginUser>, DataAccessError>>;

    /// Registers one user and returns created user payload.
    fn register_user(
        &self,
        input: AuthRegisterInput,
    ) -> BoxFuture<'_, Result<AuthRegisteredUser, DataAccessError>>;

    /// Lists organizations for a user and returns personal-organization id.
    fn list_user_organizations(
        &self,
        user_id: &str,
    ) -> BoxFuture<'_, Result<AuthUserOrganizations, DataAccessError>>;
}

/// Repository boundary for auth-related Redis session + token operations.
pub trait RedisAuthSessionRepository: Send + Sync {
    /// Creates one session row with TTL.
    fn create_session(
        &self,
        session_id: &str,
        input: AuthCreateSessionInput,
        ttl_seconds: u64,
    ) -> BoxFuture<'_, Result<(), DataAccessError>>;

    /// Returns one session row by identifier.
    fn get_session(
        &self,
        session_id: &str,
    ) -> BoxFuture<'_, Result<Option<AuthSession>, DataAccessError>>;

    /// Lists all sessions belonging to one user.
    fn get_sessions_by_user_id(
        &self,
        user_id: &str,
    ) -> BoxFuture<'_, Result<Vec<AuthSession>, DataAccessError>>;

    /// Deletes a session owned by one user.
    fn delete_session(
        &self,
        session_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>>;

    /// Stores one refresh token row with TTL.
    fn store_refresh_token(
        &self,
        token_id: &str,
        session_id: &str,
        user_id: &str,
        ttl_seconds: u64,
    ) -> BoxFuture<'_, Result<(), DataAccessError>>;

    /// Returns one refresh token row by identifier.
    fn get_refresh_token(
        &self,
        token_id: &str,
    ) -> BoxFuture<'_, Result<Option<AuthRefreshToken>, DataAccessError>>;

    /// Deletes one refresh token row.
    fn delete_refresh_token(&self, token_id: &str) -> BoxFuture<'_, Result<(), DataAccessError>>;

    /// Rotates refresh token and session rows atomically.
    fn rotate_tokens_atomically(
        &self,
        input: AuthRotateTokensInput,
    ) -> BoxFuture<'_, Result<(), DataAccessError>>;
}

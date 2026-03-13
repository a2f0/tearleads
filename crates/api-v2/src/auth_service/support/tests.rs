#![allow(clippy::expect_used)]

use std::time::{SystemTime, UNIX_EPOCH};

use jsonwebtoken::{Algorithm, EncodingKey, Header};
use tearleads_api_v2_contracts::tearleads::v2::AuthVfsKeySetup;
use tearleads_data_access_traits::{AuthSession, DataAccessError, DataAccessErrorKind};
use tonic::{Code, metadata::MetadataMap};

use super::{
    AccessTokenClaims, RefreshTokenClaims, append_set_cookie, build_clear_refresh_cookie,
    build_refresh_cookie, client_ip_from_metadata, create_access_token, create_refresh_token,
    decode_access_token, decode_refresh_token, expiry_epoch_seconds, hash_password,
    map_auth_session_summary, map_data_access_error, normalize_email, normalize_optional_non_empty,
    normalize_password, normalize_vfs_key_setup, parse_allowed_email_domains,
    parse_allowed_email_domains_value, parse_bearer_token, parse_optional_timestamp,
    parse_positive_ttl, parse_positive_ttl_env, parse_required_timestamp,
    refresh_cookie_secure_from_env, refresh_cookie_secure_from_values, refresh_token_from_cookie,
    saturating_i32, timing_safe_equal, validate_allowed_email_domain,
    validate_registration_password, verify_password,
};

fn metadata_with_authorization(value: &str) -> MetadataMap {
    let mut metadata = MetadataMap::new();
    metadata.insert(
        "authorization",
        value.parse().expect("metadata value should parse"),
    );
    metadata
}

#[test]
fn data_access_error_mapping_covers_all_kinds() {
    let not_found = map_data_access_error(DataAccessError::new(DataAccessErrorKind::NotFound, "x"));
    assert_eq!(not_found.code(), Code::NotFound);

    let denied = map_data_access_error(DataAccessError::new(
        DataAccessErrorKind::PermissionDenied,
        "x",
    ));
    assert_eq!(denied.code(), Code::PermissionDenied);

    let invalid =
        map_data_access_error(DataAccessError::new(DataAccessErrorKind::InvalidInput, "x"));
    assert_eq!(invalid.code(), Code::InvalidArgument);

    let unavailable =
        map_data_access_error(DataAccessError::new(DataAccessErrorKind::Unavailable, "x"));
    assert_eq!(unavailable.code(), Code::Unavailable);

    let internal = map_data_access_error(DataAccessError::new(DataAccessErrorKind::Internal, "x"));
    assert_eq!(internal.code(), Code::Internal);
}

#[test]
fn ttl_domain_and_cookie_env_helpers_cover_paths() {
    assert_eq!(parse_positive_ttl(Some("60".to_string()), 10), 60);
    assert_eq!(parse_positive_ttl(Some("0".to_string()), 10), 10);
    assert_eq!(parse_positive_ttl(Some("invalid".to_string()), 10), 10);
    assert_eq!(parse_positive_ttl(None, 10), 10);

    assert_eq!(
        parse_positive_ttl_env("ENV_KEY_THAT_DOES_NOT_EXIST", 90),
        90
    );

    assert_eq!(
        parse_allowed_email_domains_value("Example.com, foo.org, ,BAR.NET"),
        vec![
            "example.com".to_string(),
            "foo.org".to_string(),
            "bar.net".to_string()
        ]
    );
    assert!(
        parse_allowed_email_domains()
            .iter()
            .all(|value| !value.is_empty())
    );

    assert!(refresh_cookie_secure_from_values(
        Some("true"),
        Some("development")
    ));
    assert!(!refresh_cookie_secure_from_values(
        Some("false"),
        Some("production")
    ));
    assert!(refresh_cookie_secure_from_values(
        Some("  "),
        Some("production")
    ));
    assert!(!refresh_cookie_secure_from_values(None, Some("staging")));

    let _ = refresh_cookie_secure_from_env();
}

#[test]
fn email_and_password_validation_paths() {
    let email = normalize_email(" User@Example.com ").expect("email should normalize");
    assert_eq!(email, "user@example.com");

    let invalid_email = normalize_email("bad-email").expect_err("invalid email should fail");
    assert_eq!(invalid_email.code(), Code::InvalidArgument);

    let missing_email = normalize_email("  ").expect_err("empty email should fail");
    assert_eq!(missing_email.code(), Code::InvalidArgument);

    let password = normalize_password("  secret  ").expect("password should normalize");
    assert_eq!(password, "secret");

    let missing_password = normalize_password("   ").expect_err("empty password should fail");
    assert_eq!(missing_password.code(), Code::InvalidArgument);

    validate_registration_password("Password!123").expect("complex password should pass");
    let short = validate_registration_password("Short1!").expect_err("short password should fail");
    assert_eq!(short.code(), Code::InvalidArgument);

    let weak = validate_registration_password("alllowercasepassword")
        .expect_err("weak password should fail");
    assert_eq!(weak.code(), Code::InvalidArgument);

    validate_allowed_email_domain("user@example.com", &[])
        .expect("empty allow-list should be permissive");
    validate_allowed_email_domain("user@example.com", &["example.com".to_string()])
        .expect("allowed domain should pass");

    let invalid = validate_allowed_email_domain("userexample.com", &["example.com".to_string()])
        .expect_err("invalid email format should fail");
    assert_eq!(invalid.code(), Code::InvalidArgument);

    let denied = validate_allowed_email_domain("user@nope.com", &["example.com".to_string()])
        .expect_err("non-allowed domain should fail");
    assert_eq!(denied.code(), Code::InvalidArgument);
}

#[test]
fn vfs_key_setup_and_optional_normalization_paths() {
    let normalized = normalize_vfs_key_setup(AuthVfsKeySetup {
        public_encryption_key: " pub-key ".to_string(),
        public_signing_key: Some(" sign-key ".to_string()),
        encrypted_private_keys: " enc ".to_string(),
        argon2_salt: " salt ".to_string(),
    })
    .expect("valid setup should normalize");
    assert_eq!(normalized.public_encryption_key, "pub-key");
    assert_eq!(normalized.public_signing_key.as_deref(), Some("sign-key"));
    assert_eq!(normalized.encrypted_private_keys, "enc");
    assert_eq!(normalized.argon2_salt, "salt");

    let no_signing = normalize_vfs_key_setup(AuthVfsKeySetup {
        public_encryption_key: "pub-key".to_string(),
        public_signing_key: Some("   ".to_string()),
        encrypted_private_keys: "enc".to_string(),
        argon2_salt: "salt".to_string(),
    })
    .expect("blank signing key should become none");
    assert_eq!(no_signing.public_signing_key, None);

    let invalid = normalize_vfs_key_setup(AuthVfsKeySetup {
        public_encryption_key: " ".to_string(),
        public_signing_key: None,
        encrypted_private_keys: "enc".to_string(),
        argon2_salt: "salt".to_string(),
    })
    .expect_err("missing required field should fail");
    assert_eq!(invalid.code(), Code::InvalidArgument);

    assert_eq!(normalize_optional_non_empty("  "), None);
    assert_eq!(
        normalize_optional_non_empty(" hello "),
        Some("hello".to_string())
    );
}

#[test]
fn password_hash_verify_and_timing_safe_paths() {
    let (salt, hash) = hash_password("Password!123").expect("hashing should work");
    let valid = verify_password("Password!123", &salt, &hash).expect("verification should work");
    assert!(valid);

    let wrong = verify_password("WrongPassword!123", &salt, &hash)
        .expect("verification should work for wrong password");
    assert!(!wrong);

    let invalid_hash =
        verify_password("Password!123", &salt, "not-base64").expect_err("invalid hash should fail");
    assert_eq!(invalid_hash.code(), Code::Internal);

    let empty_hash =
        verify_password("Password!123", &salt, "").expect_err("empty hash should fail");
    assert_eq!(empty_hash.code(), Code::Internal);

    assert!(timing_safe_equal(b"abc", b"abc"));
    assert!(!timing_safe_equal(b"abc", b"abd"));
    assert!(!timing_safe_equal(b"abc", b"ab"));
}

#[test]
fn metadata_cookie_and_bearer_helpers_cover_paths() {
    let mut forwarded = MetadataMap::new();
    forwarded.insert(
        "x-forwarded-for",
        "1.2.3.4, 5.6.7.8".parse().expect("parse"),
    );
    assert_eq!(client_ip_from_metadata(&forwarded), "1.2.3.4");
    let mut forwarded_single = MetadataMap::new();
    forwarded_single.insert("x-forwarded-for", "10.0.0.1".parse().expect("parse"));
    assert_eq!(client_ip_from_metadata(&forwarded_single), "10.0.0.1");
    let mut forwarded_blank_first = MetadataMap::new();
    forwarded_blank_first.insert("x-forwarded-for", ",10.0.0.3".parse().expect("parse"));
    assert_eq!(client_ip_from_metadata(&forwarded_blank_first), "127.0.0.1");

    let mut real_ip = MetadataMap::new();
    real_ip.insert("x-real-ip", " 9.8.7.6 ".parse().expect("parse"));
    assert_eq!(client_ip_from_metadata(&real_ip), "9.8.7.6");
    let mut real_ip_single = MetadataMap::new();
    real_ip_single.insert("x-real-ip", "10.0.0.2".parse().expect("parse"));
    assert_eq!(client_ip_from_metadata(&real_ip_single), "10.0.0.2");
    let mut real_ip_blank = MetadataMap::new();
    real_ip_blank.insert("x-real-ip", "   ".parse().expect("parse"));
    assert_eq!(client_ip_from_metadata(&real_ip_blank), "127.0.0.1");

    let fallback = MetadataMap::new();
    assert_eq!(client_ip_from_metadata(&fallback), "127.0.0.1");

    assert_eq!(refresh_token_from_cookie(&MetadataMap::new()), None);

    let mut cookie_missing_value = MetadataMap::new();
    cookie_missing_value.insert("cookie", "tearleads_refresh_token=".parse().expect("parse"));
    assert_eq!(refresh_token_from_cookie(&cookie_missing_value), None);
    let mut cookie_without_target = MetadataMap::new();
    cookie_without_target.insert("cookie", "a=1; b=2".parse().expect("parse"));
    assert_eq!(refresh_token_from_cookie(&cookie_without_target), None);

    let mut cookie_present = MetadataMap::new();
    cookie_present.insert(
        "cookie",
        "a=1; tearleads_refresh_token=token-123; b=2"
            .parse()
            .expect("parse"),
    );
    assert_eq!(
        refresh_token_from_cookie(&cookie_present),
        Some("token-123".to_string())
    );

    let refresh_cookie = build_refresh_cookie("token-123", 3600, true);
    assert!(refresh_cookie.contains("tearleads_refresh_token=token-123"));
    assert!(refresh_cookie.contains("Secure"));

    let clear_cookie = build_clear_refresh_cookie(false);
    assert!(clear_cookie.contains("Max-Age=0"));
    assert!(!clear_cookie.contains("Secure"));
    let clear_cookie_secure = build_clear_refresh_cookie(true);
    assert!(clear_cookie_secure.contains("Secure"));

    let mut metadata = MetadataMap::new();
    append_set_cookie(&mut metadata, "k=v".to_string()).expect("set-cookie should append");
    assert!(metadata.get("set-cookie").is_some());

    let append_error = append_set_cookie(&mut metadata, "bad\nvalue".to_string())
        .expect_err("invalid cookie should fail");
    assert_eq!(append_error.code(), Code::Internal);

    let bearer = parse_bearer_token(&metadata_with_authorization("Bearer abc.def.ghi"))
        .expect("bearer token should parse");
    assert_eq!(bearer, "abc.def.ghi");

    let missing = parse_bearer_token(&MetadataMap::new()).expect_err("missing bearer should fail");
    assert_eq!(missing.code(), Code::Unauthenticated);

    let malformed = parse_bearer_token(&metadata_with_authorization("Basic value"))
        .expect_err("malformed bearer should fail");
    assert_eq!(malformed.code(), Code::Unauthenticated);
}

#[test]
fn timestamp_and_session_mapping_paths() {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_secs() as usize;

    let future = expiry_epoch_seconds(60);
    assert!(future >= now);
    assert!(expiry_epoch_seconds(u64::MAX) >= now);

    assert_eq!(saturating_i32(123), 123);
    assert_eq!(saturating_i32(u64::MAX), i32::MAX);

    let parsed_optional = parse_optional_timestamp("2026-03-13T12:00:00Z")
        .expect("valid optional timestamp should parse");
    assert!(parsed_optional.seconds > 0);
    assert_eq!(parse_optional_timestamp("not-a-timestamp"), None);

    let parsed_required = parse_required_timestamp("field", "2026-03-13T12:00:00Z")
        .expect("valid required timestamp should parse");
    assert!(parsed_required.seconds > 0);

    let invalid_required = parse_required_timestamp("field", "invalid")
        .expect_err("invalid required timestamp should fail");
    assert_eq!(invalid_required.code(), Code::Internal);

    let mapped = map_auth_session_summary(
        AuthSession {
            id: "session-1".to_string(),
            user_id: "user-1".to_string(),
            email: "user-1@example.com".to_string(),
            admin: true,
            created_at: "2026-03-13T12:00:00Z".to_string(),
            last_active_at: "2026-03-13T12:10:00Z".to_string(),
            ip_address: "127.0.0.1".to_string(),
        },
        "session-1",
    )
    .expect("session summary should map");
    assert!(mapped.is_current);
    assert!(mapped.is_admin);

    let invalid_mapped = map_auth_session_summary(
        AuthSession {
            id: "session-2".to_string(),
            user_id: "user-2".to_string(),
            email: "user-2@example.com".to_string(),
            admin: false,
            created_at: "invalid".to_string(),
            last_active_at: "invalid".to_string(),
            ip_address: "127.0.0.1".to_string(),
        },
        "session-1",
    )
    .expect_err("invalid created_at should fail");
    assert_eq!(invalid_mapped.code(), Code::Internal);
}

#[test]
fn access_and_refresh_token_creation_and_decode_paths() {
    let secret = "secret";

    let access = create_access_token(secret, "user-1", "user-1@example.com", "session-1", 600)
        .expect("access token should mint");
    let access_claims = decode_access_token(secret, &access).expect("access token should decode");
    assert_eq!(access_claims.sub, "user-1");
    assert_eq!(access_claims.jti, "session-1");

    let bad_access =
        decode_access_token("wrong-secret", &access).expect_err("wrong secret should fail");
    assert_eq!(bad_access.code(), Code::Unauthenticated);

    let refresh = create_refresh_token(secret, "user-1", "refresh-1", "session-1", 600)
        .expect("refresh token should mint");
    let refresh_claims =
        decode_refresh_token(secret, &refresh).expect("refresh token should decode");
    assert_eq!(refresh_claims.sub, "user-1");
    assert_eq!(refresh_claims.jti, "refresh-1");

    let wrong_secret =
        decode_refresh_token("wrong-secret", &refresh).expect_err("wrong secret should fail");
    assert_eq!(wrong_secret.code(), Code::Unauthenticated);

    let exp = expiry_epoch_seconds(60);
    let non_refresh = jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &RefreshTokenClaims {
            sub: "user-1".to_string(),
            jti: "refresh-1".to_string(),
            sid: "session-1".to_string(),
            token_type: "access".to_string(),
            exp,
        },
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .expect("token should encode");

    let wrong_type =
        decode_refresh_token(secret, &non_refresh).expect_err("non-refresh token type should fail");
    assert_eq!(wrong_type.code(), Code::Unauthenticated);

    let _claims_marker = AccessTokenClaims {
        sub: "user-1".to_string(),
        email: "user-1@example.com".to_string(),
        jti: "session-1".to_string(),
        exp,
    };
}

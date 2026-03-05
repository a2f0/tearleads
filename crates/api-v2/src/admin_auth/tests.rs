use tonic::Code;

use super::{
    AdminAccessContext, AdminAuthError, AdminAuthErrorKind, AdminOperation, AdminRequestAuthorizer,
    HeaderRoleAdminAuthorizer, map_admin_auth_error,
};

#[test]
fn header_role_authorizer_rejects_root_only_operation_without_scope_header() {
    let authorizer = HeaderRoleAdminAuthorizer;
    let mut metadata = tonic::metadata::MetadataMap::new();
    metadata.insert(
        "x-tearleads-role",
        tonic::metadata::MetadataValue::from_static("admin"),
    );

    let result = authorizer.authorize_admin_operation(AdminOperation::GetTables, &metadata);
    assert!(result.is_err());
    assert_eq!(
        result.as_ref().err().map(|error| error.kind()),
        Some(AdminAuthErrorKind::PermissionDenied)
    );
    assert!(
        result
            .as_ref()
            .err()
            .map(|error| error.message().contains("missing x-tearleads-admin-scope"))
            .unwrap_or(false)
    );
}

#[test]
fn header_role_authorizer_accepts_root_scope_for_root_only_operation() {
    let authorizer = HeaderRoleAdminAuthorizer;
    let mut metadata = tonic::metadata::MetadataMap::new();
    metadata.insert(
        "x-tearleads-role",
        tonic::metadata::MetadataValue::from_static("admin"),
    );
    metadata.insert(
        "x-tearleads-admin-scope",
        tonic::metadata::MetadataValue::from_static("root"),
    );

    let result = authorizer.authorize_admin_operation(AdminOperation::GetRows, &metadata);
    assert_eq!(result, Ok(AdminAccessContext::root()));
}

#[test]
fn header_role_authorizer_rejects_org_scope_for_root_only_operation() {
    let authorizer = HeaderRoleAdminAuthorizer;
    let mut metadata = tonic::metadata::MetadataMap::new();
    metadata.insert(
        "x-tearleads-role",
        tonic::metadata::MetadataValue::from_static("admin"),
    );
    metadata.insert(
        "x-tearleads-admin-scope",
        tonic::metadata::MetadataValue::from_static("org"),
    );
    metadata.insert(
        "x-tearleads-admin-organization-ids",
        tonic::metadata::MetadataValue::from_static("org-1"),
    );

    let result = authorizer.authorize_admin_operation(AdminOperation::GetRows, &metadata);
    assert!(result.is_err());
    assert_eq!(
        result.as_ref().err().map(|error| error.kind()),
        Some(AdminAuthErrorKind::PermissionDenied)
    );
    assert!(
        result
            .as_ref()
            .err()
            .map(|error| error.message().contains("root admin scope required"))
            .unwrap_or(false)
    );
}

#[test]
fn header_role_authorizer_accepts_scoped_org_access_for_scoped_operations() {
    let authorizer = HeaderRoleAdminAuthorizer;
    let mut metadata = tonic::metadata::MetadataMap::new();
    metadata.insert(
        "x-tearleads-role",
        tonic::metadata::MetadataValue::from_static("admin"),
    );
    metadata.insert(
        "x-tearleads-admin-scope",
        tonic::metadata::MetadataValue::from_static("org"),
    );
    metadata.insert(
        "x-tearleads-admin-organization-ids",
        tonic::metadata::MetadataValue::from_static(" org-1 , org-2 "),
    );

    let result = match authorizer.authorize_admin_operation(AdminOperation::GetContext, &metadata) {
        Ok(value) => value,
        Err(error) => panic!("scoped auth should be accepted: {error:?}"),
    };

    assert!(!result.is_root_admin());
    assert_eq!(
        result.organization_ids(),
        &[String::from("org-1"), String::from("org-2")]
    );
}

#[test]
fn header_role_authorizer_rejects_scoped_operation_without_scope_metadata() {
    let authorizer = HeaderRoleAdminAuthorizer;
    let mut metadata = tonic::metadata::MetadataMap::new();
    metadata.insert(
        "x-tearleads-role",
        tonic::metadata::MetadataValue::from_static("admin"),
    );

    let result = authorizer.authorize_admin_operation(AdminOperation::ListGroups, &metadata);
    assert!(result.is_err());
    assert_eq!(
        result.as_ref().err().map(|error| error.kind()),
        Some(AdminAuthErrorKind::PermissionDenied)
    );
    assert!(
        result
            .as_ref()
            .err()
            .map(|error| error.message().contains("missing x-tearleads-admin-scope"))
            .unwrap_or(false)
    );
}

#[test]
fn header_role_authorizer_rejects_org_scope_without_organization_ids() {
    let authorizer = HeaderRoleAdminAuthorizer;
    let mut metadata = tonic::metadata::MetadataMap::new();
    metadata.insert(
        "x-tearleads-role",
        tonic::metadata::MetadataValue::from_static("admin"),
    );
    metadata.insert(
        "x-tearleads-admin-scope",
        tonic::metadata::MetadataValue::from_static("org"),
    );

    let result = authorizer.authorize_admin_operation(AdminOperation::ListOrganizations, &metadata);
    assert!(result.is_err());
    assert_eq!(
        result.as_ref().err().map(|error| error.kind()),
        Some(AdminAuthErrorKind::PermissionDenied)
    );
    assert!(
        result
            .as_ref()
            .err()
            .map(|error| {
                error
                    .message()
                    .contains("missing x-tearleads-admin-organization-ids")
            })
            .unwrap_or(false)
    );
}

#[test]
fn header_role_authorizer_rejects_empty_org_scope_ids() {
    let authorizer = HeaderRoleAdminAuthorizer;
    let mut metadata = tonic::metadata::MetadataMap::new();
    metadata.insert(
        "x-tearleads-role",
        tonic::metadata::MetadataValue::from_static("admin"),
    );
    metadata.insert(
        "x-tearleads-admin-scope",
        tonic::metadata::MetadataValue::from_static("org"),
    );
    metadata.insert(
        "x-tearleads-admin-organization-ids",
        tonic::metadata::MetadataValue::from_static(" , "),
    );

    let result = authorizer.authorize_admin_operation(AdminOperation::ListUsers, &metadata);
    assert!(result.is_err());
    assert_eq!(
        result.as_ref().err().map(|error| error.kind()),
        Some(AdminAuthErrorKind::PermissionDenied)
    );
    assert!(
        result
            .as_ref()
            .err()
            .map(|error| error.message().contains("at least one organization id"))
            .unwrap_or(false)
    );
}

#[test]
fn header_role_authorizer_rejects_invalid_scope_value() {
    let authorizer = HeaderRoleAdminAuthorizer;
    let mut metadata = tonic::metadata::MetadataMap::new();
    metadata.insert(
        "x-tearleads-role",
        tonic::metadata::MetadataValue::from_static("admin"),
    );
    metadata.insert(
        "x-tearleads-admin-scope",
        tonic::metadata::MetadataValue::from_static("team"),
    );

    let result = authorizer.authorize_admin_operation(AdminOperation::GetContext, &metadata);
    assert!(result.is_err());
    assert_eq!(
        result.as_ref().err().map(|error| error.kind()),
        Some(AdminAuthErrorKind::PermissionDenied)
    );
    assert!(
        result
            .as_ref()
            .err()
            .map(|error| {
                error
                    .message()
                    .contains("invalid x-tearleads-admin-scope value")
            })
            .unwrap_or(false)
    );
}

#[test]
fn header_role_authorizer_rejects_non_utf8_scope_header() {
    let authorizer = HeaderRoleAdminAuthorizer;
    let mut metadata = tonic::metadata::MetadataMap::new();
    metadata.insert(
        "x-tearleads-role",
        tonic::metadata::MetadataValue::from_static("admin"),
    );
    let invalid_scope = parse_opaque_ascii_value(b"root\xfa");
    metadata.insert("x-tearleads-admin-scope", invalid_scope);

    let result = authorizer.authorize_admin_operation(AdminOperation::GetContext, &metadata);
    assert!(result.is_err());
    assert_eq!(
        result.as_ref().err().map(|error| error.kind()),
        Some(AdminAuthErrorKind::Unauthenticated)
    );
    assert!(
        result
            .as_ref()
            .err()
            .map(|error| error.message().contains("invalid x-tearleads-admin-scope"))
            .unwrap_or(false)
    );
}

#[test]
fn header_role_authorizer_rejects_non_utf8_org_ids_header() {
    let authorizer = HeaderRoleAdminAuthorizer;
    let mut metadata = tonic::metadata::MetadataMap::new();
    metadata.insert(
        "x-tearleads-role",
        tonic::metadata::MetadataValue::from_static("admin"),
    );
    metadata.insert(
        "x-tearleads-admin-scope",
        tonic::metadata::MetadataValue::from_static("org"),
    );
    metadata.insert(
        "x-tearleads-admin-organization-ids",
        parse_opaque_ascii_value(b"org-1\xfa"),
    );

    let result = authorizer.authorize_admin_operation(AdminOperation::GetContext, &metadata);
    assert!(result.is_err());
    assert_eq!(
        result.as_ref().err().map(|error| error.kind()),
        Some(AdminAuthErrorKind::Unauthenticated)
    );
    assert!(
        result
            .as_ref()
            .err()
            .map(|error| {
                error
                    .message()
                    .contains("invalid x-tearleads-admin-organization-ids")
            })
            .unwrap_or(false)
    );
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
        (AdminOperation::DeleteRedisKey, "delete_redis_key"),
        (AdminOperation::GetRedisDbSize, "get_redis_db_size"),
        (AdminOperation::GetContext, "get_context"),
        (AdminOperation::ListGroups, "list_groups"),
        (AdminOperation::GetGroup, "get_group"),
        (AdminOperation::GetGroupMembers, "get_group_members"),
        (AdminOperation::ListOrganizations, "list_organizations"),
        (AdminOperation::GetOrganization, "get_organization"),
        (AdminOperation::GetOrgGroups, "get_org_groups"),
        (AdminOperation::ListUsers, "list_users"),
        (AdminOperation::GetUser, "get_user"),
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

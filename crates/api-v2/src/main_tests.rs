use super::{
    DEFAULT_PORT, is_native_connect_path, runtime_dependency_error_message,
    should_proxy_connect_request,
};
use crate::startup::{is_enabled_env_value, read_port_value};

#[test]
fn admin_paths_are_native() {
    assert!(is_native_connect_path(
        "/connect/tearleads.v2.AdminService/GetTables"
    ));
    assert!(!should_proxy_connect_request(
        "/connect/tearleads.v2.AdminService/GetTables"
    ));
}

#[test]
fn billing_paths_are_native() {
    assert!(is_native_connect_path(
        "/connect/tearleads.v2.BillingService/GetOrganizationBilling"
    ));
    assert!(!should_proxy_connect_request(
        "/connect/tearleads.v2.BillingService/GetOrganizationBilling"
    ));
}

#[test]
fn chat_paths_are_native() {
    assert!(is_native_connect_path(
        "/connect/tearleads.v2.ChatService/PostCompletions"
    ));
    assert!(!should_proxy_connect_request(
        "/connect/tearleads.v2.ChatService/PostCompletions"
    ));
}

#[test]
fn ai_paths_are_native() {
    assert!(is_native_connect_path(
        "/connect/tearleads.v2.AiService/GetUsage"
    ));
    assert!(!should_proxy_connect_request(
        "/connect/tearleads.v2.AiService/GetUsage"
    ));
}

#[test]
fn auth_paths_are_native() {
    assert!(is_native_connect_path(
        "/connect/tearleads.v2.AuthService/Login"
    ));
    assert!(!should_proxy_connect_request(
        "/connect/tearleads.v2.AuthService/Login"
    ));
}

#[test]
fn mls_paths_are_native() {
    assert!(is_native_connect_path(
        "/connect/tearleads.v2.MlsService/GetGroup"
    ));
    assert!(!should_proxy_connect_request(
        "/connect/tearleads.v2.MlsService/GetGroup"
    ));
}

#[test]
fn notification_paths_are_native() {
    assert!(is_native_connect_path(
        "/connect/tearleads.v2.NotificationService/Subscribe"
    ));
    assert!(!should_proxy_connect_request(
        "/connect/tearleads.v2.NotificationService/Subscribe"
    ));
}

#[test]
fn revenuecat_paths_are_native() {
    assert!(is_native_connect_path(
        "/connect/tearleads.v2.RevenuecatService/HandleWebhook"
    ));
    assert!(!should_proxy_connect_request(
        "/connect/tearleads.v2.RevenuecatService/HandleWebhook"
    ));
}

#[test]
fn vfs_paths_are_native() {
    assert!(is_native_connect_path(
        "/connect/tearleads.v2.VfsService/GetSync"
    ));
    assert!(!should_proxy_connect_request(
        "/connect/tearleads.v2.VfsService/GetSync"
    ));
}

#[test]
fn vfs_shares_paths_are_native() {
    assert!(is_native_connect_path(
        "/connect/tearleads.v2.VfsSharesService/GetItemShares"
    ));
    assert!(!should_proxy_connect_request(
        "/connect/tearleads.v2.VfsSharesService/GetItemShares"
    ));
}

#[test]
fn other_connect_paths_are_proxied() {
    assert!(should_proxy_connect_request(
        "/connect/unknown.Service/Method"
    ));
}

#[test]
fn runtime_dependency_errors_require_explicit_harness_mode() {
    assert_eq!(runtime_dependency_error_message(true, true), None);
    assert_eq!(
        runtime_dependency_error_message(false, true),
        Some(
            "api-v2 runtime dependencies unavailable: missing postgres. Set API_V2_ENABLE_ADMIN_HARNESS=1 to run static fixtures intentionally.".to_string()
        )
    );
    assert_eq!(
        runtime_dependency_error_message(true, false),
        Some(
            "api-v2 runtime dependencies unavailable: missing redis. Set API_V2_ENABLE_ADMIN_HARNESS=1 to run static fixtures intentionally.".to_string()
        )
    );
    assert_eq!(
        runtime_dependency_error_message(false, false),
        Some(
            "api-v2 runtime dependencies unavailable: missing postgres, redis. Set API_V2_ENABLE_ADMIN_HARNESS=1 to run static fixtures intentionally.".to_string()
        )
    );
}

#[test]
fn enabled_env_var_trims_truthy_values() {
    assert!(is_enabled_env_value(Some("  YeS ")));
}

#[test]
fn enabled_env_var_rejects_falsey_and_missing_values() {
    assert!(!is_enabled_env_value(Some("0")));
    assert!(!is_enabled_env_value(None));
}

#[test]
fn read_port_uses_valid_env_value() {
    assert_eq!(read_port_value(Some("7010")), 7010);
}

#[test]
fn read_port_falls_back_for_missing_or_invalid_values() {
    assert_eq!(read_port_value(Some("invalid")), DEFAULT_PORT);
    assert_eq!(read_port_value(None), DEFAULT_PORT);
}

use super::{
    is_native_connect_path, runtime_dependency_error_message, should_proxy_connect_request,
};

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

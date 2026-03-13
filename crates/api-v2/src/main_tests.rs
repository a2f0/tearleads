use super::{is_native_connect_path, should_proxy_connect_request};

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
fn other_connect_paths_are_proxied() {
    assert!(should_proxy_connect_request(
        "/connect/tearleads.v2.NotificationService/Subscribe"
    ));
}

use tearleads_data_access_traits::{
    AdminGroupDetail, AdminGroupMember, AdminGroupSummary, AdminOrganizationSummary,
    AdminScopeOrganization, AdminUserAccountingSummary, AdminUserSummary,
    OrganizationBillingAccount,
};

pub(super) fn scope_organizations() -> Vec<AdminScopeOrganization> {
    vec![
        AdminScopeOrganization {
            id: String::from("org-1"),
            name: String::from("Organization 1"),
        },
        AdminScopeOrganization {
            id: String::from("org-2"),
            name: String::from("Organization 2"),
        },
    ]
}

pub(super) fn group_summaries() -> Vec<AdminGroupSummary> {
    vec![
        AdminGroupSummary {
            id: String::from("group-1"),
            organization_id: String::from("org-1"),
            name: String::from("Core Admin"),
            description: Some(String::from("Admin operators")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
            member_count: 2,
        },
        AdminGroupSummary {
            id: String::from("group-2"),
            organization_id: String::from("org-2"),
            name: String::from("Support"),
            description: None,
            created_at: String::from("2026-01-02T00:00:00Z"),
            updated_at: String::from("2026-01-02T00:00:00Z"),
            member_count: 1,
        },
    ]
}

pub(super) fn group_details() -> Vec<AdminGroupDetail> {
    vec![
        AdminGroupDetail {
            id: String::from("group-1"),
            organization_id: String::from("org-1"),
            name: String::from("Core Admin"),
            description: Some(String::from("Admin operators")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
            members: vec![
                AdminGroupMember {
                    user_id: String::from("user-1"),
                    email: String::from("admin@example.com"),
                    joined_at: String::from("2026-01-01T00:00:00Z"),
                },
                AdminGroupMember {
                    user_id: String::from("user-2"),
                    email: String::from("operator@example.com"),
                    joined_at: String::from("2026-01-02T00:00:00Z"),
                },
            ],
        },
        AdminGroupDetail {
            id: String::from("group-2"),
            organization_id: String::from("org-2"),
            name: String::from("Support"),
            description: None,
            created_at: String::from("2026-01-02T00:00:00Z"),
            updated_at: String::from("2026-01-02T00:00:00Z"),
            members: vec![AdminGroupMember {
                user_id: String::from("user-3"),
                email: String::from("support@example.com"),
                joined_at: String::from("2026-01-03T00:00:00Z"),
            }],
        },
    ]
}

pub(super) fn organization_summaries() -> Vec<AdminOrganizationSummary> {
    vec![
        AdminOrganizationSummary {
            id: String::from("org-1"),
            name: String::from("Organization 1"),
            description: Some(String::from("Primary organization")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-01-01T00:00:00Z"),
        },
        AdminOrganizationSummary {
            id: String::from("org-2"),
            name: String::from("Organization 2"),
            description: None,
            created_at: String::from("2026-01-02T00:00:00Z"),
            updated_at: String::from("2026-01-02T00:00:00Z"),
        },
    ]
}

pub(super) fn user_summaries() -> Vec<AdminUserSummary> {
    vec![
        AdminUserSummary {
            id: String::from("user-1"),
            email: String::from("admin@example.com"),
            email_confirmed: true,
            admin: true,
            organization_ids: vec![String::from("org-1")],
            created_at: Some(String::from("2026-01-01T00:00:00Z")),
            last_active_at: Some(String::from("2026-01-04T00:00:00Z")),
            accounting: AdminUserAccountingSummary {
                total_prompt_tokens: 120,
                total_completion_tokens: 40,
                total_tokens: 160,
                request_count: 12,
                last_used_at: Some(String::from("2026-01-04T00:00:00Z")),
            },
            disabled: false,
            disabled_at: None,
            disabled_by: None,
            marked_for_deletion_at: None,
            marked_for_deletion_by: None,
        },
        AdminUserSummary {
            id: String::from("user-2"),
            email: String::from("operator@example.com"),
            email_confirmed: true,
            admin: false,
            organization_ids: vec![String::from("org-2")],
            created_at: Some(String::from("2026-01-02T00:00:00Z")),
            last_active_at: None,
            accounting: AdminUserAccountingSummary {
                total_prompt_tokens: 0,
                total_completion_tokens: 0,
                total_tokens: 0,
                request_count: 0,
                last_used_at: None,
            },
            disabled: false,
            disabled_at: None,
            disabled_by: None,
            marked_for_deletion_at: None,
            marked_for_deletion_by: None,
        },
    ]
}

pub(super) fn organization_billing_accounts() -> Vec<OrganizationBillingAccount> {
    vec![
        OrganizationBillingAccount {
            organization_id: String::from("org-1"),
            revenuecat_app_user_id: String::from("org:org-1"),
            entitlement_status: String::from("active"),
            active_product_id: Some(String::from("pro_monthly")),
            period_ends_at: Some(String::from("2026-04-01T12:00:00Z")),
            will_renew: Some(true),
            last_webhook_event_id: Some(String::from("evt_fixture_1")),
            last_webhook_at: Some(String::from("2026-03-01T12:00:00Z")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-03-01T12:00:00Z"),
        },
        OrganizationBillingAccount {
            organization_id: String::from("org-2"),
            revenuecat_app_user_id: String::from("org:org-2"),
            entitlement_status: String::from("inactive"),
            active_product_id: None,
            period_ends_at: None,
            will_renew: None,
            last_webhook_event_id: None,
            last_webhook_at: None,
            created_at: String::from("2026-01-02T00:00:00Z"),
            updated_at: String::from("2026-01-02T00:00:00Z"),
        },
    ]
}

use tearleads_data_access_traits::{
    AdminCreateGroupInput, AdminCreateOrganizationInput, AdminUpdateOrganizationInput,
    AdminUpdateUserInput, AiRecordUsageInput, AiUsageQuery, DataAccessErrorKind,
    PostgresAdminRepository, PostgresAiUsageRepository, PostgresAuthRepository,
    PostgresBillingRepository,
};

use super::StaticPostgresRepository;

#[tokio::test]
async fn create_group_rejects_missing_organization() {
    let result = StaticPostgresRepository
        .create_group(AdminCreateGroupInput {
            organization_id: String::from("org-missing"),
            name: String::from("New Group"),
            description: None,
        })
        .await;
    let error = match result {
        Ok(_) => panic!("org-missing should return not found"),
        Err(error) => error,
    };

    assert_eq!(error.kind(), DataAccessErrorKind::NotFound);
    assert_eq!(error.message(), "organization not found: org-missing");
}

#[tokio::test]
async fn add_group_member_rejects_missing_user() {
    let result = StaticPostgresRepository
        .add_group_member("group-1", "user-missing")
        .await;
    let error = match result {
        Ok(_) => panic!("user-missing should return not found"),
        Err(error) => error,
    };

    assert_eq!(error.kind(), DataAccessErrorKind::NotFound);
    assert_eq!(error.message(), "user not found: user-missing");
}

#[tokio::test]
async fn create_organization_rejects_duplicate_name() {
    let result = StaticPostgresRepository
        .create_organization(AdminCreateOrganizationInput {
            name: String::from("duplicate-organization-name"),
            description: None,
        })
        .await;
    let error = match result {
        Ok(_) => panic!("duplicate organization name should fail"),
        Err(error) => error,
    };

    assert_eq!(error.kind(), DataAccessErrorKind::InvalidInput);
    assert_eq!(error.message(), "organization name already exists");
}

#[tokio::test]
async fn create_organization_returns_created_record() {
    let organization = match StaticPostgresRepository
        .create_organization(AdminCreateOrganizationInput {
            name: String::from("New Org"),
            description: Some(String::from("Created in test")),
        })
        .await
    {
        Ok(organization) => organization,
        Err(error) => panic!("create should succeed: {error}"),
    };

    assert_eq!(organization.id, "org-created");
    assert_eq!(organization.name, "New Org");
    assert_eq!(organization.description.as_deref(), Some("Created in test"));
}

#[tokio::test]
async fn update_organization_applies_patch_fields() {
    let organization = match StaticPostgresRepository
        .update_organization(
            "org-1",
            AdminUpdateOrganizationInput {
                name: Some(String::from("Renamed Org 1")),
                description: Some(Some(String::from("Updated description"))),
            },
        )
        .await
    {
        Ok(organization) => organization,
        Err(error) => panic!("update should succeed: {error}"),
    };

    assert_eq!(organization.id, "org-1");
    assert_eq!(organization.name, "Renamed Org 1");
    assert_eq!(
        organization.description.as_deref(),
        Some("Updated description")
    );
}

#[tokio::test]
async fn update_organization_rejects_missing_organization() {
    let result = StaticPostgresRepository
        .update_organization(
            "org-missing",
            AdminUpdateOrganizationInput {
                name: Some(String::from("irrelevant")),
                description: None,
            },
        )
        .await;
    let error = match result {
        Ok(_) => panic!("missing organization should fail"),
        Err(error) => error,
    };

    assert_eq!(error.kind(), DataAccessErrorKind::NotFound);
    assert_eq!(error.message(), "organization not found: org-missing");
}

#[tokio::test]
async fn delete_organization_reports_existence() {
    let deleted_existing = match StaticPostgresRepository.delete_organization("org-1").await {
        Ok(deleted) => deleted,
        Err(error) => panic!("existing organization should delete: {error}"),
    };
    let deleted_missing = match StaticPostgresRepository
        .delete_organization("org-missing")
        .await
    {
        Ok(deleted) => deleted,
        Err(error) => panic!("missing organization delete should not error: {error}"),
    };

    assert!(deleted_existing);
    assert!(!deleted_missing);
}

#[tokio::test]
async fn update_user_sets_disabled_and_marked_for_deletion_flags() {
    let user = match StaticPostgresRepository
        .update_user(
            "user-1",
            AdminUpdateUserInput {
                disabled: Some(true),
                marked_for_deletion: Some(true),
                ..Default::default()
            },
        )
        .await
    {
        Ok(user) => user,
        Err(error) => panic!("update should succeed: {error}"),
    };

    assert!(user.disabled);
    assert_eq!(user.disabled_by.as_deref(), Some("admin-root"));
    assert_eq!(user.marked_for_deletion_by.as_deref(), Some("admin-root"));
}

#[tokio::test]
async fn update_user_rejects_duplicate_email() {
    let result = StaticPostgresRepository
        .update_user(
            "user-1",
            AdminUpdateUserInput {
                email: Some(String::from("duplicate@example.com")),
                ..Default::default()
            },
        )
        .await;
    let error = match result {
        Ok(_) => panic!("duplicate email should fail"),
        Err(error) => error,
    };

    assert_eq!(error.kind(), DataAccessErrorKind::InvalidInput);
    assert_eq!(error.message(), "email already exists");
}

#[tokio::test]
async fn update_user_rejects_missing_user() {
    let result = StaticPostgresRepository
        .update_user(
            "user-missing",
            AdminUpdateUserInput {
                admin: Some(true),
                ..Default::default()
            },
        )
        .await;
    let error = match result {
        Ok(_) => panic!("missing user should fail"),
        Err(error) => error,
    };

    assert_eq!(error.kind(), DataAccessErrorKind::NotFound);
    assert_eq!(error.message(), "user not found: user-missing");
}

#[tokio::test]
async fn update_user_applies_scalar_fields_and_clears_flags() {
    let user = match StaticPostgresRepository
        .update_user(
            "user-1",
            AdminUpdateUserInput {
                email: Some(String::from("renamed@example.com")),
                email_confirmed: Some(false),
                admin: Some(false),
                organization_ids: Some(vec![String::from("org-2")]),
                disabled: Some(false),
                marked_for_deletion: Some(false),
            },
        )
        .await
    {
        Ok(user) => user,
        Err(error) => panic!("update should succeed: {error}"),
    };

    assert_eq!(user.email, "renamed@example.com");
    assert!(!user.email_confirmed);
    assert!(!user.admin);
    assert_eq!(user.organization_ids, vec![String::from("org-2")]);
    assert!(!user.disabled);
    assert_eq!(user.disabled_at, None);
    assert_eq!(user.disabled_by, None);
    assert_eq!(user.marked_for_deletion_at, None);
    assert_eq!(user.marked_for_deletion_by, None);
}

#[tokio::test]
async fn update_user_leaves_flags_unchanged_when_not_provided() {
    let user = match StaticPostgresRepository
        .update_user(
            "user-1",
            AdminUpdateUserInput {
                email: Some(String::from("flagless@example.com")),
                ..Default::default()
            },
        )
        .await
    {
        Ok(user) => user,
        Err(error) => panic!("update should succeed: {error}"),
    };

    assert_eq!(user.email, "flagless@example.com");
    assert!(!user.disabled);
    assert_eq!(user.disabled_at, None);
    assert_eq!(user.disabled_by, None);
    assert_eq!(user.marked_for_deletion_at, None);
    assert_eq!(user.marked_for_deletion_by, None);
}

#[tokio::test]
async fn auth_repository_login_register_and_organizations_cover_paths() {
    let missing_login = StaticPostgresRepository
        .find_login_user("missing@example.com")
        .await
        .expect("missing login lookup should succeed");
    assert!(missing_login.is_none());

    let admin_login = StaticPostgresRepository
        .find_login_user("  ADMIN@EXAMPLE.COM ")
        .await
        .expect("admin login lookup should succeed")
        .expect("fixture admin should exist");
    assert_eq!(admin_login.id, "user-1");
    assert_eq!(admin_login.email, "admin@example.com");
    assert!(admin_login.admin);

    let duplicate_register = StaticPostgresRepository
        .register_user(tearleads_data_access_traits::AuthRegisterInput {
            email: String::from("admin@example.com"),
            password_hash: String::from("hash"),
            password_salt: String::from("salt"),
            vfs_key_setup: None,
        })
        .await
        .expect_err("duplicate email should fail");
    assert_eq!(duplicate_register.kind(), DataAccessErrorKind::InvalidInput);

    let created = StaticPostgresRepository
        .register_user(tearleads_data_access_traits::AuthRegisterInput {
            email: String::from("new@example.com"),
            password_hash: String::from("hash"),
            password_salt: String::from("salt"),
            vfs_key_setup: None,
        })
        .await
        .expect("new email should register");
    assert_eq!(created.id, "user-created");
    assert_eq!(created.email, "new@example.com");

    let organizations = StaticPostgresRepository
        .list_user_organizations("user-1")
        .await
        .expect("fixture organizations should resolve");
    assert_eq!(organizations.personal_organization_id, "org-1");
    assert!(!organizations.organizations.is_empty());

    let missing_user = StaticPostgresRepository
        .list_user_organizations("user-missing")
        .await
        .expect_err("missing user should fail");
    assert_eq!(missing_user.kind(), DataAccessErrorKind::NotFound);

    let missing_personal_org = StaticPostgresRepository
        .list_user_organizations("user-empty-orgs")
        .await
        .expect_err("empty org list should fail");
    assert_eq!(missing_personal_org.kind(), DataAccessErrorKind::Internal);
    assert_eq!(
        missing_personal_org.message(),
        "user personal organization id not found"
    );
}

#[tokio::test]
async fn billing_repository_membership_and_account_paths() {
    let is_member = StaticPostgresRepository
        .user_has_organization_membership("user-1", "org-1")
        .await
        .expect("membership check should succeed");
    assert!(is_member);

    let not_member = StaticPostgresRepository
        .user_has_organization_membership("user-1", "org-missing")
        .await
        .expect("membership check should succeed");
    assert!(!not_member);

    let existing_account = StaticPostgresRepository
        .get_organization_billing_account("org-1")
        .await
        .expect("billing account lookup should succeed");
    assert!(existing_account.is_some());

    let missing_account = StaticPostgresRepository
        .get_organization_billing_account("org-missing")
        .await
        .expect("billing account lookup should succeed");
    assert!(missing_account.is_none());
}

#[tokio::test]
async fn ai_usage_repository_records_lists_and_summarizes() {
    let saved = StaticPostgresRepository
        .record_usage(
            "user-1",
            AiRecordUsageInput {
                conversation_id: Some(String::from("conversation-1")),
                message_id: Some(String::from("message-1")),
                model_id: String::from("mistralai/mistral-7b-instruct"),
                prompt_tokens: 9,
                completion_tokens: 3,
                total_tokens: 12,
                openrouter_request_id: Some(String::from("req-1")),
            },
        )
        .await
        .expect("record usage should succeed");
    assert_eq!(saved.user_id, "user-1");
    assert!(saved.id.starts_with("usage-"));

    let first_page = StaticPostgresRepository
        .list_usage(
            "user-1",
            AiUsageQuery {
                start_date: Some(String::from("2026-03-09T00:00:00Z")),
                end_date: Some(String::from("2026-03-11T00:00:00Z")),
                cursor: None,
                limit: 1,
            },
        )
        .await
        .expect("list usage should succeed");
    assert_eq!(first_page.usage.len(), 1);
    assert!(first_page.has_more);
    assert!(first_page.cursor.is_some());

    let end_date_filtered = StaticPostgresRepository
        .list_usage(
            "user-1",
            AiUsageQuery {
                start_date: None,
                end_date: Some(String::from("2026-03-10T12:00:00Z")),
                cursor: None,
                limit: 10,
            },
        )
        .await
        .expect("end date filter should succeed");
    assert!(!end_date_filtered.usage.is_empty());

    let after_cursor = StaticPostgresRepository
        .list_usage(
            "user-1",
            AiUsageQuery {
                start_date: None,
                end_date: None,
                cursor: first_page.cursor.clone(),
                limit: 10,
            },
        )
        .await
        .expect("list usage with cursor should succeed");
    assert!(after_cursor.usage.len() <= 1);

    let empty_page = StaticPostgresRepository
        .list_usage(
            "user-1",
            AiUsageQuery {
                start_date: Some(String::from("2027-01-01T00:00:00Z")),
                end_date: None,
                cursor: None,
                limit: 10,
            },
        )
        .await
        .expect("list usage with empty range should succeed");
    assert!(empty_page.usage.is_empty());
    assert_eq!(empty_page.summary.request_count, 0);

    let summary = StaticPostgresRepository
        .get_usage_summary(
            "user-1",
            Some(String::from("2026-03-01T00:00:00Z")),
            Some(String::from("2026-03-11T00:00:00Z")),
        )
        .await
        .expect("usage summary should succeed");
    assert!(summary.summary.request_count >= 1);
    assert!(!summary.by_model.is_empty());
}

use tearleads_data_access_traits::{
    AdminCreateGroupInput, AdminCreateOrganizationInput, AdminUpdateOrganizationInput,
    AdminUpdateUserInput, DataAccessErrorKind, PostgresAdminRepository,
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

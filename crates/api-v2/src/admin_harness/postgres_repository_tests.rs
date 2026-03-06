use tearleads_data_access_traits::{
    AdminCreateGroupInput, AdminCreateOrganizationInput, AdminUpdateUserInput, DataAccessErrorKind,
    PostgresAdminReadRepository,
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

use tearleads_data_access_traits::{
    AdminCreateGroupInput, DataAccessErrorKind, PostgresAdminReadRepository,
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

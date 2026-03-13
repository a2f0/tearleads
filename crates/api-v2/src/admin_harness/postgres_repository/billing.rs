use tearleads_data_access_traits::{
    BoxFuture, DataAccessError, OrganizationBillingAccount, PostgresBillingRepository,
};

use super::{StaticPostgresRepository, fixtures};

impl PostgresBillingRepository for StaticPostgresRepository {
    fn user_has_organization_membership(
        &self,
        user_id: &str,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let user_id = user_id.to_string();
        let organization_id = organization_id.to_string();

        Box::pin(async move {
            let users = fixtures::user_summaries();
            Ok(users.into_iter().any(|user| {
                user.id == user_id
                    && user
                        .organization_ids
                        .iter()
                        .any(|id| id == &organization_id)
            }))
        })
    }

    fn get_organization_billing_account(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<Option<OrganizationBillingAccount>, DataAccessError>> {
        let organization_id = organization_id.to_string();

        Box::pin(async move {
            let account = fixtures::organization_billing_accounts()
                .into_iter()
                .find(|entry| entry.organization_id == organization_id);
            Ok(account)
        })
    }
}

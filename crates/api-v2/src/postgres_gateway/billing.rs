use chrono::{DateTime, Utc};
use tearleads_data_access_traits::{
    BoxFuture, DataAccessError, OrganizationBillingAccount, PostgresBillingRepository,
};

use super::TokioPostgresGateway;
use super::error::{pool_error, query_error};

fn to_rfc3339(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339()
}

impl PostgresBillingRepository for TokioPostgresGateway {
    fn user_has_organization_membership(
        &self,
        user_id: &str,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let user_id = user_id.to_string();
        let organization_id = organization_id.to_string();

        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let rows = client
                .query(
                    "SELECT organization_id
                     FROM user_organizations
                     WHERE user_id = $1
                       AND organization_id = $2
                     LIMIT 1",
                    &[&user_id, &organization_id],
                )
                .await
                .map_err(query_error)?;
            Ok(!rows.is_empty())
        })
    }

    fn get_organization_billing_account(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<Option<OrganizationBillingAccount>, DataAccessError>> {
        let organization_id = organization_id.to_string();

        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let rows = client
                .query(
                    "SELECT
                        organization_id,
                        revenuecat_app_user_id,
                        entitlement_status,
                        active_product_id,
                        period_ends_at,
                        will_renew,
                        last_webhook_event_id,
                        last_webhook_at,
                        created_at,
                        updated_at
                     FROM organization_billing_accounts
                     WHERE organization_id = $1
                     LIMIT 1",
                    &[&organization_id],
                )
                .await
                .map_err(query_error)?;

            let Some(row) = rows.into_iter().next() else {
                return Ok(None);
            };

            let period_ends_at: Option<DateTime<Utc>> = row.get("period_ends_at");
            let last_webhook_at: Option<DateTime<Utc>> = row.get("last_webhook_at");
            let created_at: DateTime<Utc> = row.get("created_at");
            let updated_at: DateTime<Utc> = row.get("updated_at");

            Ok(Some(OrganizationBillingAccount {
                organization_id: row.get("organization_id"),
                revenuecat_app_user_id: row.get("revenuecat_app_user_id"),
                entitlement_status: row.get("entitlement_status"),
                active_product_id: row.get("active_product_id"),
                period_ends_at: period_ends_at.map(to_rfc3339),
                will_renew: row.get("will_renew"),
                last_webhook_event_id: row.get("last_webhook_event_id"),
                last_webhook_at: last_webhook_at.map(to_rfc3339),
                created_at: to_rfc3339(created_at),
                updated_at: to_rfc3339(updated_at),
            }))
        })
    }
}

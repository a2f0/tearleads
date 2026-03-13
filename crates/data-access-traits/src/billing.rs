//! Postgres read models and repository boundary for billing RPCs.

use crate::{BoxFuture, DataAccessError};

/// Billing account payload returned for organization billing reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrganizationBillingAccount {
    /// Organization identifier.
    pub organization_id: String,
    /// RevenueCat app user identifier for the organization.
    pub revenuecat_app_user_id: String,
    /// Entitlement status label.
    pub entitlement_status: String,
    /// Optional active product identifier.
    pub active_product_id: Option<String>,
    /// Optional RFC3339 period end timestamp.
    pub period_ends_at: Option<String>,
    /// Optional renewal flag.
    pub will_renew: Option<bool>,
    /// Optional latest webhook event identifier.
    pub last_webhook_event_id: Option<String>,
    /// Optional RFC3339 latest webhook timestamp.
    pub last_webhook_at: Option<String>,
    /// RFC3339 creation timestamp.
    pub created_at: String,
    /// RFC3339 update timestamp.
    pub updated_at: String,
}

/// Repository boundary for billing access checks and account reads.
pub trait PostgresBillingRepository: Send + Sync {
    /// Returns whether `user_id` belongs to `organization_id`.
    fn user_has_organization_membership(
        &self,
        user_id: &str,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>>;

    /// Returns billing account payload for one organization.
    fn get_organization_billing_account(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<Option<OrganizationBillingAccount>, DataAccessError>>;
}

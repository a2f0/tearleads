//! Contract-first billing RPC handlers backed by repository traits.

use chrono::{DateTime, Utc};
use prost_types::Timestamp;
use tearleads_api_v2_contracts::tearleads::v2::{
    GetOrganizationBillingRequest, GetOrganizationBillingResponse, OrganizationBillingAccount,
    billing_service_server::BillingService,
};
use tearleads_data_access_traits::PostgresBillingRepository;
use tonic::{Request, Response, Status};

use crate::admin_service_common::map_data_access_error;
use crate::billing_auth::{
    BillingRequestAuthorizer, JwtSessionBillingAuthorizer, map_billing_auth_error,
};

/// Trait-backed implementation of `tearleads.v2.BillingService`.
pub struct BillingServiceHandler<P, A = JwtSessionBillingAuthorizer> {
    billing_repo: P,
    authorizer: A,
}

impl<P, A> BillingServiceHandler<P, A> {
    /// Creates a new billing handler from repository and auth policy implementations.
    pub fn with_authorizer(billing_repo: P, authorizer: A) -> Self {
        Self {
            billing_repo,
            authorizer,
        }
    }
}

impl<P> BillingServiceHandler<P, JwtSessionBillingAuthorizer> {
    /// Creates a new billing handler using runtime JWT/session authorization policy.
    pub fn new(billing_repo: P) -> Self {
        Self::with_authorizer(billing_repo, JwtSessionBillingAuthorizer::from_env())
    }
}

#[tonic::async_trait]
impl<P, A> BillingService for BillingServiceHandler<P, A>
where
    P: PostgresBillingRepository + Send + Sync + 'static,
    A: BillingRequestAuthorizer + Send + Sync + 'static,
{
    async fn get_organization_billing(
        &self,
        request: Request<GetOrganizationBillingRequest>,
    ) -> Result<Response<GetOrganizationBillingResponse>, Status> {
        let access = self
            .authorizer
            .authorize_billing_request(request.metadata())
            .await
            .map_err(map_billing_auth_error)?;

        let payload = request.into_inner();
        let organization_id = normalize_organization_id(&payload.organization_id)?;

        let is_member = self
            .billing_repo
            .user_has_organization_membership(access.user_id(), &organization_id)
            .await
            .map_err(map_data_access_error)?;
        if !is_member {
            return Err(Status::permission_denied("Forbidden"));
        }

        let account = self
            .billing_repo
            .get_organization_billing_account(&organization_id)
            .await
            .map_err(map_data_access_error)?
            .ok_or_else(|| Status::not_found("Billing account not found"))?;

        Ok(Response::new(GetOrganizationBillingResponse {
            billing_account: Some(OrganizationBillingAccount {
                organization_id: account.organization_id,
                revenuecat_app_user_id: account.revenuecat_app_user_id,
                entitlement_status: account.entitlement_status,
                active_product_id: account.active_product_id,
                period_ends_at: parse_optional_timestamp(
                    "period_ends_at",
                    account.period_ends_at.as_deref(),
                )?,
                will_renew: account.will_renew,
                last_webhook_event_id: account.last_webhook_event_id,
                last_webhook_at: parse_optional_timestamp(
                    "last_webhook_at",
                    account.last_webhook_at.as_deref(),
                )?,
                created_at: Some(parse_required_timestamp("created_at", &account.created_at)?),
                updated_at: Some(parse_required_timestamp("updated_at", &account.updated_at)?),
            }),
        }))
    }
}

fn normalize_organization_id(value: &str) -> Result<String, Status> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(Status::invalid_argument("organizationId is required"));
    }
    Ok(normalized.to_string())
}

fn parse_optional_timestamp(
    field: &'static str,
    value: Option<&str>,
) -> Result<Option<Timestamp>, Status> {
    value
        .map(|raw| parse_required_timestamp(field, raw))
        .transpose()
}

fn parse_required_timestamp(field: &'static str, value: &str) -> Result<Timestamp, Status> {
    let parsed = DateTime::parse_from_rfc3339(value).map_err(|_| {
        Status::internal(format!(
            "billing account contains invalid {field} timestamp"
        ))
    })?;
    let utc = parsed.with_timezone(&Utc);
    Ok(Timestamp {
        seconds: utc.timestamp(),
        nanos: utc.timestamp_subsec_nanos() as i32,
    })
}

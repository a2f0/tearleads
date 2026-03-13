//! Integration tests for the v2 billing service handler core.
#![allow(clippy::expect_used)]

use std::sync::{Arc, Mutex, MutexGuard};

use tearleads_api_v2::{
    BillingAccessContext, BillingAuthError, BillingAuthErrorKind, BillingRequestAuthorizer,
    BillingServiceHandler,
};
use tearleads_api_v2_contracts::tearleads::v2::{
    GetOrganizationBillingRequest, billing_service_server::BillingService,
};
use tearleads_data_access_traits::{
    BoxFuture, DataAccessError, DataAccessErrorKind, OrganizationBillingAccount,
    PostgresBillingRepository,
};
use tonic::{Code, Request};

#[derive(Debug, Clone)]
struct FakeAuthorizer {
    outcome: Result<BillingAccessContext, BillingAuthError>,
}

impl FakeAuthorizer {
    fn allow(user_id: &str) -> Self {
        Self {
            outcome: Ok(BillingAccessContext::new(user_id)),
        }
    }

    fn deny(kind: BillingAuthErrorKind, message: &str) -> Self {
        Self {
            outcome: Err(BillingAuthError::new(kind, message)),
        }
    }
}

impl BillingRequestAuthorizer for FakeAuthorizer {
    fn authorize_billing_request(
        &self,
        _metadata: &tonic::metadata::MetadataMap,
    ) -> BoxFuture<'_, Result<BillingAccessContext, BillingAuthError>> {
        let result = self.outcome.clone();
        Box::pin(async move { result })
    }
}

#[derive(Debug, Clone)]
struct FakeBillingRepository {
    membership_result: Result<bool, DataAccessError>,
    membership_calls: Arc<Mutex<Vec<(String, String)>>>,
    account_result: Result<Option<OrganizationBillingAccount>, DataAccessError>,
    account_calls: Arc<Mutex<Vec<String>>>,
}

impl Default for FakeBillingRepository {
    fn default() -> Self {
        Self {
            membership_result: Ok(true),
            membership_calls: Arc::new(Mutex::new(Vec::new())),
            account_result: Ok(None),
            account_calls: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl PostgresBillingRepository for FakeBillingRepository {
    fn user_has_organization_membership(
        &self,
        user_id: &str,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        lock_or_recover(&self.membership_calls)
            .push((user_id.to_string(), organization_id.to_string()));
        let result = self.membership_result.clone();
        Box::pin(async move { result })
    }

    fn get_organization_billing_account(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<Option<OrganizationBillingAccount>, DataAccessError>> {
        lock_or_recover(&self.account_calls).push(organization_id.to_string());
        let result = self.account_result.clone();
        Box::pin(async move { result })
    }
}

#[tokio::test]
async fn get_organization_billing_maps_repository_payload() {
    let repository = FakeBillingRepository {
        membership_result: Ok(true),
        account_result: Ok(Some(OrganizationBillingAccount {
            organization_id: String::from("org-1"),
            revenuecat_app_user_id: String::from("org:org-1"),
            entitlement_status: String::from("active"),
            active_product_id: Some(String::from("pro_monthly")),
            period_ends_at: Some(String::from("2026-04-01T12:00:00Z")),
            will_renew: Some(true),
            last_webhook_event_id: Some(String::from("evt_123")),
            last_webhook_at: Some(String::from("2026-03-01T12:00:00Z")),
            created_at: String::from("2026-01-01T00:00:00Z"),
            updated_at: String::from("2026-03-01T12:00:00Z"),
        })),
        ..Default::default()
    };
    let membership_calls = Arc::clone(&repository.membership_calls);
    let account_calls = Arc::clone(&repository.account_calls);

    let handler =
        BillingServiceHandler::with_authorizer(repository, FakeAuthorizer::allow("user-1"));

    let payload = handler
        .get_organization_billing(Request::new(GetOrganizationBillingRequest {
            organization_id: String::from(" org-1 "),
        }))
        .await
        .expect("billing request should succeed")
        .into_inner();

    assert_eq!(
        lock_or_recover(&membership_calls).clone(),
        vec![(String::from("user-1"), String::from("org-1"))]
    );
    assert_eq!(
        lock_or_recover(&account_calls).clone(),
        vec![String::from("org-1")]
    );

    let account = payload
        .billing_account
        .expect("billing account should be set");
    assert_eq!(account.organization_id, "org-1");
    assert_eq!(account.revenuecat_app_user_id, "org:org-1");
    assert_eq!(account.entitlement_status, "active");
    assert_eq!(account.active_product_id.as_deref(), Some("pro_monthly"));
    assert_eq!(account.will_renew, Some(true));
    assert_eq!(account.last_webhook_event_id.as_deref(), Some("evt_123"));
    assert!(account.period_ends_at.is_some());
    assert!(account.last_webhook_at.is_some());
    assert!(account.created_at.is_some());
    assert!(account.updated_at.is_some());
}

#[tokio::test]
async fn rejects_missing_auth_context() {
    let handler = BillingServiceHandler::with_authorizer(
        FakeBillingRepository::default(),
        FakeAuthorizer::deny(BillingAuthErrorKind::Unauthenticated, "Unauthorized"),
    );

    let status = handler
        .get_organization_billing(Request::new(GetOrganizationBillingRequest {
            organization_id: String::from("org-1"),
        }))
        .await
        .expect_err("unauthenticated request should fail");

    assert_eq!(status.code(), Code::Unauthenticated);
}

#[tokio::test]
async fn rejects_blank_organization_id() {
    let handler = BillingServiceHandler::with_authorizer(
        FakeBillingRepository::default(),
        FakeAuthorizer::allow("user-1"),
    );

    let status = handler
        .get_organization_billing(Request::new(GetOrganizationBillingRequest {
            organization_id: String::from("   "),
        }))
        .await
        .expect_err("blank organization id must fail");

    assert_eq!(status.code(), Code::InvalidArgument);
    assert_eq!(status.message(), "organizationId is required");
}

#[tokio::test]
async fn rejects_when_user_is_not_member_of_organization() {
    let handler = BillingServiceHandler::with_authorizer(
        FakeBillingRepository {
            membership_result: Ok(false),
            ..Default::default()
        },
        FakeAuthorizer::allow("user-1"),
    );

    let status = handler
        .get_organization_billing(Request::new(GetOrganizationBillingRequest {
            organization_id: String::from("org-1"),
        }))
        .await
        .expect_err("missing membership must fail");

    assert_eq!(status.code(), Code::PermissionDenied);
}

#[tokio::test]
async fn returns_not_found_when_billing_account_is_missing() {
    let handler = BillingServiceHandler::with_authorizer(
        FakeBillingRepository {
            membership_result: Ok(true),
            account_result: Ok(None),
            ..Default::default()
        },
        FakeAuthorizer::allow("user-1"),
    );

    let status = handler
        .get_organization_billing(Request::new(GetOrganizationBillingRequest {
            organization_id: String::from("org-1"),
        }))
        .await
        .expect_err("missing billing account must fail");

    assert_eq!(status.code(), Code::NotFound);
}

#[tokio::test]
async fn maps_data_access_failures_to_internal_status() {
    let handler = BillingServiceHandler::with_authorizer(
        FakeBillingRepository {
            membership_result: Err(DataAccessError::new(
                DataAccessErrorKind::Internal,
                "db down",
            )),
            ..Default::default()
        },
        FakeAuthorizer::allow("user-1"),
    );

    let status = handler
        .get_organization_billing(Request::new(GetOrganizationBillingRequest {
            organization_id: String::from("org-1"),
        }))
        .await
        .expect_err("repository failures must map to internal");

    assert_eq!(status.code(), Code::Internal);
}

fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

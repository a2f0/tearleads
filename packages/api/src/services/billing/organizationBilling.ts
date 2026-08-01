import { getSyncBillingTierForNativeProduct } from "@tearleads/validators/billing";
import type {
  OrganizationBillingHistoryResponse,
  OrganizationBillingManagementUrlResponse,
  OrganizationBillingResponse,
} from "@tearleads/validators/response";
import {
  serializeOrganizationBilling,
  serializeOrganizationBillingHistory,
} from "../../billing/organizationBilling";
import {
  fetchRevenueCatManagementUrl,
  type RevenueCatApiDeps,
} from "../../billing/revenueCatApi";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { getSyncBillingTierForStripePrice } from "../../billing/stripeHttp";
import {
  runGetOrganizationBillingWorkflow,
  runResolveOrganizationBillingCustomerWorkflow,
  runStartOrganizationTrialWorkflow,
} from "../../workflows/billing/organizationBilling";
import { runGetOrganizationBillingHistoryWorkflow } from "../../workflows/billing/organizationBillingHistory";
import type { ApiServiceRuntime } from "../runtime";

export async function getOrganizationBilling(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationBillingResponse> {
  const result = await runGetOrganizationBillingWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  return serializeOrganizationBilling(result.billing, result.activeMemberCount);
}

export async function getOrganizationBillingHistory(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationBillingHistoryResponse> {
  return serializeOrganizationBillingHistory(
    organizationId,
    await runGetOrganizationBillingHistoryWorkflow(
      runtime.db,
      organizationId,
      sessionUserId,
    ),
  );
}

/**
 * Resolves the organization's subscription-management URL from RevenueCat using
 * its stored customer id (so any admin, not just the buyer, can reach it).
 * Returns a null URL when the org has no RevenueCat-managed subscription; the
 * provider lookup runs outside any DB transaction and fails soft to null.
 */
export async function getOrganizationBillingManagementUrl(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  deps: {
    readonly revenueCat?: RevenueCatApiDeps;
    readonly stripe?: StripeApiDeps;
  } = {},
): Promise<OrganizationBillingManagementUrlResponse> {
  const {
    hasStripeSubscription,
    provider,
    providerCustomerId,
    providerProductId,
    providerSubscriptionId,
    providerTransactionId,
    status,
  } = await runResolveOrganizationBillingCustomerWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  const hasProviderSubscription = provider === "revenuecat";
  const stripeTier = hasProviderSubscription
    ? getSyncBillingTierForStripePrice(providerProductId, deps.stripe)
    : null;
  const nativeTier = hasProviderSubscription
    ? getSyncBillingTierForNativeProduct(providerProductId)
    : null;
  // A retained Stripe binding wins over a promotional/native-looking product:
  // the org may still be billed by Stripe and must keep its direct cancel path.
  const hasLiveStripeIdentity = hasStripeSubscription || stripeTier !== null;
  const canCancelDirectly =
    hasLiveStripeIdentity &&
    (status === "active" || status === "past_due" || status === "trialing");
  if (canCancelDirectly) {
    return {
      canCancelDirectly: true,
      managementUrl: null,
      subscriptionSource: "stripe",
    };
  }
  if (hasLiveStripeIdentity) {
    return {
      canCancelDirectly: false,
      managementUrl: null,
      subscriptionSource: null,
    };
  }
  const subscriptionSource = nativeTier ? "native" : null;
  if (subscriptionSource !== "native" || !providerCustomerId) {
    return {
      canCancelDirectly: false,
      managementUrl: null,
      subscriptionSource,
    };
  }
  return {
    canCancelDirectly: false,
    managementUrl: await fetchRevenueCatManagementUrl(
      providerCustomerId,
      {
        subscriptionId: providerSubscriptionId,
        transactionId: providerTransactionId,
      },
      deps.revenueCat,
    ),
    subscriptionSource,
  };
}

export async function startOrganizationTrial(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationBillingResponse> {
  const result = await runStartOrganizationTrialWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  return serializeOrganizationBilling(result.billing, result.activeMemberCount);
}

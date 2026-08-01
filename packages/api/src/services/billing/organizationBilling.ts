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
 * Resolves who manages an organization's subscription and exposes every safe
 * management path. RevenueCat lookup uses the stored customer id so any admin,
 * not just the buyer, can reach it; provider calls run outside the DB
 * transaction and fail soft to a null URL.
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
    hasActiveStripeSubscription,
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
  const statusCanBill =
    status === "active" || status === "past_due" || status === "trialing";
  const hasNativeSubscription =
    nativeTier !== null && !hasActiveStripeSubscription;
  if (hasNativeSubscription) {
    return {
      // A native takeover may retain a quarantined Stripe identity until its
      // final event. Expose both providers' management paths while it can bill.
      canCancelDirectly: hasStripeSubscription && statusCanBill,
      managementUrl: providerCustomerId
        ? await fetchRevenueCatManagementUrl(
            providerCustomerId,
            {
              subscriptionId: providerSubscriptionId,
              transactionId: providerTransactionId,
            },
            deps.revenueCat,
          )
        : null,
      subscriptionSource: "native",
    };
  }
  // An active Stripe binding wins over a legacy promotional/native-looking
  // product id because Stripe remains the billing authority.
  const hasLiveStripeIdentity =
    hasActiveStripeSubscription || stripeTier !== null;
  const canCancelDirectly = hasLiveStripeIdentity && statusCanBill;
  if (canCancelDirectly) {
    return {
      canCancelDirectly: true,
      managementUrl: null,
      subscriptionSource: "stripe",
    };
  }
  if (!hasLiveStripeIdentity && hasProviderSubscription && providerCustomerId) {
    return {
      canCancelDirectly: hasStripeSubscription && statusCanBill,
      managementUrl: await fetchRevenueCatManagementUrl(
        providerCustomerId,
        {
          subscriptionId: providerSubscriptionId,
          transactionId: providerTransactionId,
        },
        deps.revenueCat,
      ),
      subscriptionSource: "native",
    };
  }
  return {
    canCancelDirectly: false,
    managementUrl: null,
    subscriptionSource: null,
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

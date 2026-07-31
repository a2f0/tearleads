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
import { fetchRevenueCatManagementUrl } from "../../billing/revenueCatApi";
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
  return serializeOrganizationBilling(
    await runGetOrganizationBillingWorkflow(
      runtime.db,
      organizationId,
      sessionUserId,
    ),
  );
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
): Promise<OrganizationBillingManagementUrlResponse> {
  const {
    provider,
    providerCustomerId,
    providerProductId,
    providerSubscriptionId,
    providerTransactionId,
  } = await runResolveOrganizationBillingCustomerWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  const canCancelDirectly =
    getSyncBillingTierForStripePrice(providerProductId) !== null;
  if (canCancelDirectly) {
    return {
      canCancelDirectly: true,
      managementUrl: null,
      subscriptionSource: "stripe",
    };
  }
  const subscriptionSource = getSyncBillingTierForNativeProduct(
    providerProductId,
  )
    ? "native"
    : null;
  if (provider !== "revenuecat" || !providerCustomerId) {
    return {
      canCancelDirectly: false,
      managementUrl: null,
      subscriptionSource,
    };
  }
  return {
    canCancelDirectly: false,
    managementUrl: await fetchRevenueCatManagementUrl(providerCustomerId, {
      subscriptionId: providerSubscriptionId,
      transactionId: providerTransactionId,
    }),
    subscriptionSource,
  };
}

export async function startOrganizationTrial(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationBillingResponse> {
  return serializeOrganizationBilling(
    await runStartOrganizationTrialWorkflow(
      runtime.db,
      organizationId,
      sessionUserId,
    ),
  );
}

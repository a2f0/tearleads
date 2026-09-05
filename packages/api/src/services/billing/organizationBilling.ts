import { randomUUID } from "node:crypto";
import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import type {
  OrganizationBillingHistoryResponse,
  OrganizationBillingManagementUrlResponse,
  OrganizationBillingResponse,
  OrganizationNativePurchaseEligibilityResponse,
} from "@tearleads/validators/response";
import {
  serializeOrganizationBilling,
  serializeOrganizationBillingHistory,
} from "../../billing/organizationBilling";
import {
  fetchActiveRevenueCatNativeSubscription,
  fetchRevenueCatManagementUrl,
  type RevenueCatApiDeps,
} from "../../billing/revenueCatApi";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { runNativePurchaseEligibilityWorkflow } from "../../workflows/billing/nativePurchaseEligibility";
import {
  runAuthorizeNativeSubscriptionClaimWorkflow,
  runClaimNativeSubscriptionWorkflow,
} from "../../workflows/billing/nativeSubscriptionClaim";
import {
  runGetOrganizationBillingWorkflow,
  runResolveOrganizationBillingCustomerWorkflow,
  runStartOrganizationTrialWorkflow,
} from "../../workflows/billing/organizationBilling";
import { runGetOrganizationBillingHistoryWorkflow } from "../../workflows/billing/organizationBillingHistory";
import { resolveOrganizationSubscriptionOwnership } from "../../workflows/billing/organizationSubscriptionSource";
import { resolveVerifiedPlayReplacement } from "../../workflows/billing/revenuecatPlayReplacement";
import { OrganizationManagerError } from "../../workflows/organizations/errors";
import type { ApiServiceRuntime } from "../runtime";
import { mapNativeSubscriptionClaimError } from "./nativeSubscriptionClaimError";
import { OrganizationBillingProviderUnavailableError } from "./organizationBillingErrors";

export async function getOrganizationBilling(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  deps: { readonly stripe?: StripeApiDeps } = {},
): Promise<OrganizationBillingResponse> {
  const result = await runGetOrganizationBillingWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
    deps,
  );
  return serializeOrganizationBilling(result.billing, result);
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

export function getOrganizationNativePurchaseEligibility(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  store: NativeSubscriptionStore,
): Promise<OrganizationNativePurchaseEligibilityResponse> {
  return runNativePurchaseEligibilityWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
    store,
  );
}

/**
 * Resolves every safe management path for an organization's subscription. The
 * owner decision is shared with the billing snapshot; this adds the
 * RevenueCat management link for a native owner, looked up through the stored
 * customer id so any admin, not just the buyer, can reach it. Provider calls
 * run outside the DB transaction and fail soft to a null URL. A native
 * takeover may retain a quarantined Stripe identity until its final event, so
 * both providers' paths stay exposed while it can bill.
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
  const customer = await runResolveOrganizationBillingCustomerWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  const ownership = resolveOrganizationSubscriptionOwnership({
    ...customer,
    ...(deps.stripe ? { stripe: deps.stripe } : {}),
  });
  const managementUrl =
    ownership.subscriptionSource === "native" && customer.providerCustomerId
      ? await fetchRevenueCatManagementUrl(
          customer.providerCustomerId,
          {
            subscriptionId: customer.providerSubscriptionId,
            transactionId: customer.providerTransactionId,
          },
          deps.revenueCat,
        )
      : null;
  return { canCancelDirectly: ownership.canCancelDirectly, managementUrl };
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
  return serializeOrganizationBilling(result.billing, {
    ...result,
    pendingSeatCount: null,
  });
}

/**
 * Verifies the current RevenueCat App User ID's native receipt and assigns its
 * one active store subscription to a freshly provisioned restore organization.
 * Restore on the device may have transferred the receipt between App User IDs;
 * this operation moves the server-side organization binding to match.
 */
export async function claimNativeOrganizationSubscription(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  store: NativeSubscriptionStore,
  deps: RevenueCatApiDeps = {},
): Promise<OrganizationBillingResponse> {
  await runAuthorizeNativeSubscriptionClaimWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  const resolved = await fetchActiveRevenueCatNativeSubscription(
    sessionUserId,
    store,
    deps,
  );
  if (resolved.kind === "not_found") {
    throw new OrganizationManagerError(
      "No active subscription was found for this store account",
      404,
    );
  }
  if (resolved.kind === "customer_not_found") {
    throw new OrganizationBillingProviderUnavailableError(
      "The restored subscription has not propagated to RevenueCat",
    );
  }
  if (resolved.kind === "ambiguous") {
    throw new OrganizationManagerError(
      "More than one active subscription was found for this store account",
      409,
    );
  }
  if (resolved.kind === "unavailable") {
    throw new OrganizationBillingProviderUnavailableError(
      "RevenueCat could not verify the subscription",
    );
  }
  const replacementResolution =
    store === "play_store"
      ? await resolveVerifiedPlayReplacement({
          appUserId: sessionUserId,
          db: runtime.db,
          deps,
          organizationId,
          productId: resolved.subscription.productId,
          replacementSubscriptionId: resolved.subscription.subscriptionId,
        })
      : ({ kind: "none" } as const);
  if (replacementResolution.kind === "unavailable") {
    throw new OrganizationBillingProviderUnavailableError(
      "RevenueCat could not verify the subscription replacement",
    );
  }
  const now = new Date();
  const sourceId = `native-claim:${randomUUID()}`;
  try {
    await runClaimNativeSubscriptionWorkflow({
      appUserId: sessionUserId,
      auditEvent: { eventId: sourceId, eventTimestamp: now },
      db: runtime.db,
      now,
      organizationId,
      recordAlreadyOwnedAudit: false,
      requireRestoreIntent: true,
      requireSessionAccess: true,
      sourceId,
      subscription: resolved.subscription,
      verifiedReplacement:
        replacementResolution.kind === "verified"
          ? replacementResolution.replacement
          : null,
    });
  } catch (error) {
    const mapped = mapNativeSubscriptionClaimError(error);
    if (mapped) throw mapped;
    throw error;
  }
  return getOrganizationBilling(runtime, organizationId, sessionUserId);
}

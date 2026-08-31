import type { ApiDatabase } from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  users,
} from "@symcrypt/api-shared/schema";
import {
  getSyncBillingTierForNativeProduct,
  type NativeSubscriptionStore,
} from "@symcrypt/validators/billing";
import type {
  OrganizationBillingStatus,
  OrganizationNativePurchaseEligibilityResponse,
  OrganizationNativePurchaseIneligibilityReason,
} from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";
import {
  resolvePersistedNativeSubscriptionStore,
  revenueCatStoreForNativeStore,
} from "./nativeSubscriptionIdentity";
import { hasStripeBindingIdentity } from "./stripeBindingPolicy";

interface NativePurchasePolicyInput {
  readonly billing: {
    readonly provider: "revenuecat" | null;
    readonly providerCustomerId: string | null;
    readonly providerProductId: string | null;
    readonly providerSubscriptionId: string | null;
    readonly providerTransactionId: string | null;
    readonly status: OrganizationBillingStatus;
  };
  readonly hasActiveStripeCheckoutAttempt: boolean;
  readonly hasStripeBinding: boolean;
  readonly isOrgAdmin: boolean;
  readonly isPersonalOrganization: boolean;
  readonly persistedNativeStore: string | null;
  readonly sessionUserId: string;
  readonly targetNativeStore: NativeSubscriptionStore;
}

export function blocksNativePurchaseForStripeCheckoutAttempt(input: {
  readonly attemptExpiresAt: Date | null;
  readonly attemptId: string | null;
  readonly now: Date;
}): boolean {
  if (!input.attemptExpiresAt) {
    return input.attemptId !== null;
  }
  return input.attemptExpiresAt > input.now;
}

function ineligible(
  reason: OrganizationNativePurchaseIneligibilityReason,
): OrganizationNativePurchaseEligibilityResponse {
  return { eligible: false, reason };
}

/** Pure, provider-neutral policy shared by the transactional preflight. */
export function resolveNativePurchaseEligibility(
  input: NativePurchasePolicyInput,
): OrganizationNativePurchaseEligibilityResponse {
  if (!input.isOrgAdmin) {
    return ineligible("organization_admin_required");
  }
  if (!input.isPersonalOrganization) {
    return ineligible("personal_organization_required");
  }
  if (
    input.billing.status === "deleting" ||
    input.billing.status === "purged"
  ) {
    return ineligible("terminal_organization");
  }
  if (input.billing.status === "past_due") {
    return ineligible("billing_past_due");
  }
  if (input.hasActiveStripeCheckoutAttempt || input.hasStripeBinding) {
    return ineligible("stripe_subscription_conflict");
  }

  const hasProviderIdentity = Boolean(
    input.billing.provider ||
      input.billing.providerCustomerId ||
      input.billing.providerProductId ||
      input.billing.providerSubscriptionId ||
      input.billing.providerTransactionId,
  );
  if (hasProviderIdentity) {
    const isCompleteNativeBinding = Boolean(
      input.billing.provider === "revenuecat" &&
        input.billing.providerSubscriptionId &&
        getSyncBillingTierForNativeProduct(input.billing.providerProductId),
    );
    if (!isCompleteNativeBinding) {
      return ineligible("existing_subscription_conflict");
    }
    if (input.billing.providerCustomerId !== input.sessionUserId) {
      return ineligible("native_subscription_buyer_mismatch");
    }
    if (
      (input.billing.status === "active" ||
        input.billing.status === "trialing") &&
      input.persistedNativeStore !==
        revenueCatStoreForNativeStore(input.targetNativeStore)
    ) {
      return ineligible("existing_subscription_conflict");
    }
  } else if (input.billing.status === "active") {
    return ineligible("existing_subscription_conflict");
  }

  return { eligible: true, reason: null };
}

/** Reads current server policy immediately before the client opens the store. */
export function runNativePurchaseEligibilityWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  targetNativeStore: NativeSubscriptionStore,
): Promise<OrganizationNativePurchaseEligibilityResponse> {
  return db.transaction(async (tx) => {
    const access = await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      userId: sessionUserId,
    });
    const [buyer] = await tx
      .select({ defaultOrganizationId: users.defaultOrganizationId })
      .from(users)
      .where(eq(users.id, sessionUserId))
      .limit(1);
    const [billing] = await tx
      .select({
        checkoutAttemptExpiresAt: organizationBilling.checkoutAttemptExpiresAt,
        checkoutAttemptId: organizationBilling.checkoutAttemptId,
        provider: organizationBilling.provider,
        providerCustomerId: organizationBilling.providerCustomerId,
        providerProductId: organizationBilling.providerProductId,
        providerSubscriptionId: organizationBilling.providerSubscriptionId,
        providerTransactionId: organizationBilling.providerTransactionId,
        status: organizationBilling.status,
      })
      .from(organizationBilling)
      .where(eq(organizationBilling.organizationId, organizationId))
      .limit(1);
    if (!billing) {
      throw new OrganizationManagerError("Organization billing not found", 404);
    }
    const [stripeBinding] = await tx
      .select({
        subscriptionId: organizationBillingStripeSeats.subscriptionId,
        subscriptionItemId: organizationBillingStripeSeats.subscriptionItemId,
      })
      .from(organizationBillingStripeSeats)
      .where(eq(organizationBillingStripeSeats.organizationId, organizationId))
      .limit(1);
    return resolveNativePurchaseEligibility({
      billing,
      hasActiveStripeCheckoutAttempt:
        blocksNativePurchaseForStripeCheckoutAttempt({
          attemptExpiresAt: billing.checkoutAttemptExpiresAt,
          attemptId: billing.checkoutAttemptId,
          now: new Date(),
        }),
      hasStripeBinding: hasStripeBindingIdentity(stripeBinding),
      isOrgAdmin: access.isOrgAdmin,
      isPersonalOrganization: buyer?.defaultOrganizationId === organizationId,
      persistedNativeStore: await resolvePersistedNativeSubscriptionStore({
        billing,
        executor: tx,
        organizationId,
      }),
      sessionUserId,
      targetNativeStore,
    });
  });
}

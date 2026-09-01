import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { organizationBillingStripeSeats } from "@symcrypt/api-shared/schema";
import {
  getSyncBillingTierForNativeProduct,
  type NativeSubscriptionStore,
} from "@symcrypt/validators/billing";
import { eq } from "drizzle-orm";
import { OrganizationManagerError } from "../organizations/errors";
import {
  blocksNativePurchaseForStripeCheckoutAttempt,
  resolveNativePurchaseEligibility,
} from "./nativePurchaseEligibility";
import {
  hasAcceptedPlayReplacement,
  resolvePersistedNativeSubscriptionStore,
  revenueCatStoreForNativeStore,
} from "./nativeSubscriptionIdentity";
import {
  hasAppliedStripeExpiration,
  hasStripeBindingIdentity,
} from "./stripeBindingPolicy";

type NativeClaimBilling = Parameters<
  typeof resolveNativePurchaseEligibility
>[0]["billing"] & {
  readonly checkoutAttemptExpiresAt: Date | null;
  readonly checkoutAttemptId: string | null;
  readonly organizationId: string;
};

interface NativeClaimEligibilityInput {
  readonly appUserId: string;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly productId: string;
  readonly store: NativeSubscriptionStore;
  readonly subscriptionId: string;
  readonly target: NativeClaimBilling;
}

async function loadStripeBinding(
  executor: DatabaseSession,
  organizationId: string,
) {
  const [binding] = await executor
    .select({
      subscriptionId: organizationBillingStripeSeats.subscriptionId,
      subscriptionItemId: organizationBillingStripeSeats.subscriptionItemId,
    })
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId))
    .limit(1);
  return binding;
}

async function resolveClaimNativeStore(
  input: NativeClaimEligibilityInput,
): Promise<string | null> {
  const persistedStore = await resolvePersistedNativeSubscriptionStore({
    billing: input.target,
    executor: input.executor,
    organizationId: input.target.organizationId,
  });
  if (persistedStore) return persistedStore;
  const claimsExistingNativeBinding = Boolean(
    input.target.provider === "revenuecat" &&
      input.target.providerCustomerId === input.appUserId &&
      input.target.providerSubscriptionId === input.subscriptionId &&
      getSyncBillingTierForNativeProduct(input.target.providerProductId),
  );
  // The provider-verified claim supplies store identity for an exact legacy
  // binding that predates store audit rows. Never override a conflicting row.
  return claimsExistingNativeBinding
    ? revenueCatStoreForNativeStore(input.store)
    : null;
}

async function hasConflictingActiveNativeBinding(
  input: NativeClaimEligibilityInput,
): Promise<boolean> {
  if (
    (input.target.status !== "active" && input.target.status !== "trialing") ||
    input.target.providerSubscriptionId === null ||
    input.target.providerSubscriptionId === input.subscriptionId
  ) {
    return false;
  }
  return !(await hasAcceptedPlayReplacement({
    appUserId: input.appUserId,
    currentSubscriptionId: input.target.providerSubscriptionId,
    executor: input.executor,
    organizationId: input.target.organizationId,
    productId: input.productId,
    store: input.store,
    subscriptionId: input.subscriptionId,
  }));
}

/** Reuses purchase policy against the locked billing row before a claim. */
export async function assertNativeClaimEligibility(
  input: NativeClaimEligibilityInput,
): Promise<{ readonly deleteExpiredStripeBinding: boolean }> {
  const binding = await loadStripeBinding(
    input.executor,
    input.target.organizationId,
  );
  const hasActiveStripeCheckoutAttempt =
    blocksNativePurchaseForStripeCheckoutAttempt({
      attemptExpiresAt: input.target.checkoutAttemptExpiresAt,
      attemptId: input.target.checkoutAttemptId,
      now: input.now,
    });
  const hasStripeBinding = hasStripeBindingIdentity(binding);
  const hasExpiredStripeBinding = await hasAppliedStripeExpiration({
    billingStatus: input.target.status,
    binding,
    executor: input.executor,
    organizationId: input.target.organizationId,
  });
  const eligibility = resolveNativePurchaseEligibility({
    billing: input.target,
    hasActiveStripeCheckoutAttempt,
    hasExpiredStripeBinding,
    hasStripeBinding: hasStripeBinding && !hasExpiredStripeBinding,
    isOrgAdmin: true,
    isPersonalOrganization: true,
    persistedNativeStore: await resolveClaimNativeStore(input),
    sessionUserId: input.appUserId,
    targetNativeStore: input.store,
  });
  if (eligibility.eligible) {
    if (await hasConflictingActiveNativeBinding(input)) {
      throw new OrganizationManagerError(
        "The organization already has a different subscription",
        409,
      );
    }
    return { deleteExpiredStripeBinding: hasExpiredStripeBinding };
  }
  if (eligibility.reason === "terminal_organization") {
    throw new OrganizationManagerError(
      "Organization purge is terminal; provision a replacement organization",
      409,
    );
  }
  if (
    eligibility.reason === "stripe_subscription_conflict" &&
    hasActiveStripeCheckoutAttempt
  ) {
    throw new OrganizationManagerError(
      "A web checkout is already in progress for this organization",
      409,
    );
  }
  if (eligibility.reason === "stripe_subscription_conflict") {
    throw new OrganizationManagerError(
      "Cancel the organization's web subscription before moving a native subscription",
      409,
    );
  }
  if (
    input.target.providerSubscriptionId !== null &&
    input.target.providerSubscriptionId !== input.subscriptionId
  ) {
    throw new OrganizationManagerError(
      "The organization already has a different subscription",
      409,
    );
  }
  if (
    input.target.providerProductId !== null &&
    getSyncBillingTierForNativeProduct(input.target.providerProductId) === null
  ) {
    throw new OrganizationManagerError(
      "Cancel the organization's existing subscription before moving a native subscription",
      409,
    );
  }
  throw new OrganizationManagerError(
    `Native subscription claim is ineligible: ${eligibility.reason}`,
    409,
  );
}

import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { organizationBillingStripeSeats } from "@symcrypt/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@symcrypt/validators/billing";
import { eq } from "drizzle-orm";
import { OrganizationManagerError } from "../organizations/errors";
import {
  blocksNativePurchaseForStripeCheckoutAttempt,
  resolveNativePurchaseEligibility,
} from "./nativePurchaseEligibility";
import { hasStripeBindingIdentity } from "./stripeBindingPolicy";

type NativeClaimBilling = Parameters<
  typeof resolveNativePurchaseEligibility
>[0]["billing"] & {
  readonly checkoutAttemptExpiresAt: Date | null;
  readonly checkoutAttemptId: string | null;
  readonly organizationId: string;
};

/** Reuses purchase policy against the locked billing row before a claim. */
export async function assertNativeClaimEligibility(input: {
  readonly appUserId: string;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly subscriptionId: string;
  readonly target: NativeClaimBilling;
}): Promise<void> {
  const [binding] = await input.executor
    .select({
      subscriptionId: organizationBillingStripeSeats.subscriptionId,
      subscriptionItemId: organizationBillingStripeSeats.subscriptionItemId,
    })
    .from(organizationBillingStripeSeats)
    .where(
      eq(
        organizationBillingStripeSeats.organizationId,
        input.target.organizationId,
      ),
    )
    .limit(1);
  const hasActiveStripeCheckoutAttempt =
    blocksNativePurchaseForStripeCheckoutAttempt({
      attemptExpiresAt: input.target.checkoutAttemptExpiresAt,
      attemptId: input.target.checkoutAttemptId,
      now: input.now,
    });
  const eligibility = resolveNativePurchaseEligibility({
    billing: input.target,
    hasActiveStripeCheckoutAttempt,
    hasStripeBinding: hasStripeBindingIdentity(binding),
    isOrgAdmin: true,
    isPersonalOrganization: true,
    sessionUserId: input.appUserId,
  });
  if (eligibility.eligible) return;
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
      "The personal organization already has a different subscription",
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

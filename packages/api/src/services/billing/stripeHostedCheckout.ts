import { hasOpenOrgSubscription } from "../../billing/stripeApi";
import { createCheckoutSession } from "../../billing/stripeCheckoutSession";
import { findOrCreateCustomer } from "../../billing/stripeCustomer";
import {
  runAcquireStripeCheckoutAttemptWorkflow,
  runRequireCheckoutEligibleWorkflow,
} from "../../workflows/billing/stripeCheckout";
import { OrganizationManagerError } from "../../workflows/organizations/errors";
import type { ApiServiceRuntime } from "../runtime";
import {
  requireCurrentHostedAttempt,
  requireOfferedPlan,
  retireOtherCheckouts,
} from "./stripeCheckoutAttempt";
import {
  isDirectCheckoutFullyConfigured,
  type StripeCheckoutServiceDeps,
} from "./stripeCheckoutConfiguration";

/**
 * The off-site alternative to the inline form (`createStripeCheckout`):
 * returns a hosted Stripe Checkout page URL for the chosen plan. Same admin
 * gate, same local-status eligibility guard, same plan check, and the same
 * Stripe-side duplicate guard (an already-subscribed org is a 409), same
 * full-configuration requirement (the resulting subscription flows through
 * the same webhook → RevenueCat association), and the same per-(user, org)
 * customer. Before the Session is minted the buyer's own unpaid checkouts
 * from other attempts, such as the inline form this page replaces, are
 * retired, so only one way to pay can be paid. Null when unconfigured.
 */
export async function createStripeCheckoutSession(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  request: { readonly priceId: string; readonly returnUrl: string },
  deps: StripeCheckoutServiceDeps = {},
): Promise<string | null> {
  await runRequireCheckoutEligibleWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  if (!isDirectCheckoutFullyConfigured(deps)) {
    return null;
  }
  const stripe = deps.stripe ?? {};
  const attempt = await runAcquireStripeCheckoutAttemptWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
    "hosted",
    { plan: await requireOfferedPlan(request.priceId, stripe) },
  );
  const customerId = await findOrCreateCustomer(
    { userId: sessionUserId, organizationId },
    stripe,
  );
  if (!customerId) {
    return null;
  }
  await retireOtherCheckouts({
    attemptId: attempt.attemptId,
    customerId,
    db: runtime.db,
    organizationId,
    stripe,
  });
  // Stripe-side duplicate guard, mirroring the inline flow. The local billing
  // status the eligibility workflow reads can lag Stripe (e.g. a webhook
  // outage), so a session minted here could complete into a SECOND billing
  // subscription and double-bill. `createSyncSubscription` closes this window
  // for inline checkout via its own search; check explicitly here before
  // minting a hosted Session. Another buyer's still-incomplete inline
  // subscription blocks as well because its payment could complete while the
  // hosted page is open.
  if (await hasOpenOrgSubscription(organizationId, stripe)) {
    throw new OrganizationManagerError(
      "The organization already has an active subscription",
      409,
    );
  }
  // One origin-validated URL for both outcomes: the buyer lands back on the
  // billing panel whether they paid or backed out, and a paid return reads as
  // activation-pending until the webhook grants the entitlement.
  const session = await createCheckoutSession(
    {
      checkoutAttemptId: attempt.attemptId,
      customerId,
      expiresAt: attempt.providerExpiresAt ?? attempt.expiresAt,
      userId: sessionUserId,
      organizationId,
      returnUrl: request.returnUrl,
      seatQuantity: attempt.seatQuantity,
    },
    stripe,
  );
  if (!session) {
    return null;
  }
  await requireCurrentHostedAttempt({
    attemptId: attempt.attemptId,
    db: runtime.db,
    organizationId,
    sessionId: session.id,
    stripe,
  });
  return session.url;
}

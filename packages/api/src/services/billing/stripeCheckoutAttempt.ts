import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { SyncBillingTier } from "@tearleads/validators/billing";
import {
  getStripeSyncOption,
  type StripeApiDeps,
} from "../../billing/stripeApi";
import {
  expireCheckoutSession,
  expireStaleCheckoutSessions,
  voidReplacedCheckout,
  voidStaleInlineCheckouts,
} from "../../billing/stripeCheckoutVoid";
import { getSyncBillingTierForStripePrice } from "../../billing/stripeHttp";
import {
  readStripeCheckoutAttemptId,
  stripeCheckoutInProgress,
  stripeCheckoutPlanUnavailable,
} from "../../workflows/billing/stripeCheckout";

/**
 * The plan the buyer chose, from the Price they saw. Stripe charges whatever
 * the subscription says, not what the form showed, so checkout starts only a
 * configured plan whose Price Stripe still offers, checked before anything is
 * reserved; the reservation then refuses a plan the roster has outgrown.
 * Either refusal gets the same 409, which the client answers by reloading
 * the options. Callers authorize first (`runRequireCheckoutEligibleWorkflow`),
 * so an ineligible caller never reaches Stripe; the reservation repeats that
 * check atomically.
 */
export async function requireOfferedPlan(
  priceId: string,
  stripe: StripeApiDeps,
): Promise<SyncBillingTier> {
  const plan = getSyncBillingTierForStripePrice(priceId, stripe);
  if (!plan || !(await getStripeSyncOption(plan.id, stripe))) {
    throw stripeCheckoutPlanUnavailable();
  }
  return plan;
}

/**
 * The attempt rotates when the buyer chooses another plan or the other way to
 * pay, and the abandoned checkout could still charge them: an inline form's
 * subscription, or a hosted Session they left or never reached. Every
 * checkout therefore retires the buyer's unpaid checkouts from other attempts
 * before offering its own, voiding inline invoices and expiring hosted
 * Sessions: any concurrent retry, or a retry after a failed retirement,
 * retires them again. A request whose own attempt was replaced meanwhile
 * retires nothing. A payment that already went through keeps the 409.
 */
export async function retireOtherCheckouts(input: {
  readonly attemptId: string;
  readonly customerId: string;
  readonly db: ApiDatabase;
  readonly organizationId: string;
  readonly stripe: StripeApiDeps;
}): Promise<void> {
  const stale = {
    customerId: input.customerId,
    currentAttemptId: input.attemptId,
    stillReserved: async () =>
      (await readStripeCheckoutAttemptId(input.db, input.organizationId)) ===
      input.attemptId,
  };
  const retired =
    (await voidStaleInlineCheckouts(stale, input.stripe)) &&
    (await expireStaleCheckoutSessions(
      { ...stale, now: new Date() },
      input.stripe,
    ));
  if (!retired) {
    throw stripeCheckoutInProgress();
  }
}

/**
 * Hands out an inline checkout only while its attempt is still the reserved
 * one. A replacement may have rotated the attempt while this request was
 * creating the subscription, after the replacement's own void had listed
 * the buyer's subscriptions; it is voided here before its client secret
 * leaves the server. Of the rotation and this read, whichever comes second
 * sees the other.
 */
export async function requireCurrentInlineAttempt(input: {
  readonly attemptId: string;
  readonly db: ApiDatabase;
  readonly organizationId: string;
  readonly stripe: StripeApiDeps;
  readonly subscriptionId: string;
}): Promise<void> {
  const current = await readStripeCheckoutAttemptId(
    input.db,
    input.organizationId,
  );
  if (current !== input.attemptId) {
    await voidReplacedCheckout(input.subscriptionId, input.stripe);
    throw stripeCheckoutInProgress();
  }
}

/**
 * Hands out a hosted Session only while its attempt is still the reserved
 * one, as {@link requireCurrentInlineAttempt} does for the inline form: a
 * Session created after its attempt was replaced is expired before its URL
 * leaves the server.
 */
export async function requireCurrentHostedAttempt(input: {
  readonly attemptId: string;
  readonly db: ApiDatabase;
  readonly organizationId: string;
  readonly sessionId: string;
  readonly stripe: StripeApiDeps;
}): Promise<void> {
  const current = await readStripeCheckoutAttemptId(
    input.db,
    input.organizationId,
  );
  if (current !== input.attemptId) {
    await expireCheckoutSession(input.sessionId, input.stripe);
    throw stripeCheckoutInProgress();
  }
}

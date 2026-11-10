import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { voidStaleInlineCheckout } from "../../billing/stripeCheckoutVoid";
import {
  runReplaceStaleInlineCheckoutAttemptWorkflow,
  type StripeCheckoutAttempt,
  type StripeCheckoutAttemptAcquisition,
  stripeCheckoutInProgress,
} from "../../workflows/billing/stripeCheckout";

/**
 * The reserved attempt, or a 409 while a stale one stays reserved. A hosted
 * attempt is never replaced before it expires: its Checkout Session can
 * still complete.
 */
export function requireAcquiredCheckoutAttempt(
  acquisition: StripeCheckoutAttemptAcquisition,
): StripeCheckoutAttempt {
  if (acquisition.kind !== "acquired") {
    throw stripeCheckoutInProgress();
  }
  return acquisition.attempt;
}

/**
 * Replaces the buyer's own unpaid inline attempt that was reserved before the
 * roster changed, since its form would charge the old tier: void that
 * checkout, then rotate the attempt to the current seat count. A payment
 * that already went through keeps the 409. The caller has already passed the
 * admin gate the acquisition ran, and resolved this buyer's customer.
 */
export async function replaceStaleInlineCheckoutAttempt(input: {
  readonly customerId: string;
  readonly db: ApiDatabase;
  readonly organizationId: string;
  readonly sessionUserId: string;
  readonly staleAttemptId: string;
  readonly stripe: StripeApiDeps;
}): Promise<StripeCheckoutAttempt> {
  const voided = await voidStaleInlineCheckout(
    {
      customerId: input.customerId,
      checkoutAttemptId: input.staleAttemptId,
    },
    input.stripe,
  );
  if (!voided) {
    throw stripeCheckoutInProgress();
  }
  return requireAcquiredCheckoutAttempt(
    await runReplaceStaleInlineCheckoutAttemptWorkflow(
      input.db,
      input.organizationId,
      input.sessionUserId,
      input.staleAttemptId,
    ),
  );
}

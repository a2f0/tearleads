import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { StripeApiDeps } from "../../billing/stripeApi";
import {
  voidReplacedCheckout,
  voidStaleInlineCheckouts,
} from "../../billing/stripeCheckoutVoid";
import {
  readStripeCheckoutAttemptId,
  stripeCheckoutInProgress,
} from "../../workflows/billing/stripeCheckout";

/**
 * An inline attempt rotates when the roster changes under the buyer's unpaid
 * checkout, and the old form would still charge the old tier. Every inline
 * checkout therefore voids the buyer's unpaid checkouts from other attempts
 * before offering its own: any concurrent retry, or a retry after a failed
 * void, retires them again. A payment that already went through keeps the
 * 409.
 */
export async function voidOtherInlineCheckouts(input: {
  readonly attemptId: string;
  readonly customerId: string;
  readonly stripe: StripeApiDeps;
}): Promise<void> {
  const voided = await voidStaleInlineCheckouts(
    { customerId: input.customerId, currentAttemptId: input.attemptId },
    input.stripe,
  );
  if (!voided) {
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

import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { StripeApiDeps } from "../../billing/stripeApi";
import {
  voidReplacedCheckout,
  voidStaleInlineCheckout,
} from "../../billing/stripeCheckoutVoid";
import {
  readStripeCheckoutAttemptId,
  stripeCheckoutInProgress,
} from "../../workflows/billing/stripeCheckout";

/**
 * Inline checkout after the roster changed under the buyer's own unpaid
 * attempt. Acquisition already rotated that attempt; its old form would
 * charge the old tier, so its checkout is voided before the replacement is
 * offered. A payment that already went through keeps the 409.
 *
 * A request still creating a subscription for the retired attempt is covered
 * from the other side: {@link requireCurrentInlineAttempt} runs after its
 * create, so whichever of the two sees the other's write voids the old
 * checkout.
 */
export async function voidRetiredInlineCheckout(input: {
  readonly customerId: string;
  readonly retiredAttemptId: string;
  readonly stripe: StripeApiDeps;
}): Promise<void> {
  const voided = await voidStaleInlineCheckout(
    { customerId: input.customerId, checkoutAttemptId: input.retiredAttemptId },
    input.stripe,
  );
  if (!voided) {
    throw stripeCheckoutInProgress();
  }
}

/**
 * Hands out an inline checkout only while its attempt is still the reserved
 * one. A replacement may have rotated the attempt while this request was
 * creating the subscription; the replacement's void could not see it then,
 * so it is voided here before its client secret leaves the server.
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

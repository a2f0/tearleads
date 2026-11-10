import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import {
  BILLING_ERROR_CODES,
  getSyncBillingTierForSeatCount,
} from "@tearleads/validators/billing";
import type { StripeApiDeps } from "../../billing/stripeApi";
import {
  voidReplacedCheckout,
  voidStaleInlineCheckouts,
} from "../../billing/stripeCheckoutVoid";
import { getStripePriceIdForTier } from "../../billing/stripeHttp";
import {
  readStripeCheckoutAttemptId,
  stripeCheckoutInProgress,
} from "../../workflows/billing/stripeCheckout";
import { OrganizationManagerError } from "../../workflows/organizations/errors";

/**
 * The inline form shows a Price before any subscription exists, and Stripe
 * charges whatever the subscription says, not what the form showed. Pay
 * therefore names the Price the buyer saw, and the checkout proceeds only
 * when the seat count its attempt reserves (the one the subscription is
 * created for) still maps to it. It runs inside the reservation, so a refused
 * Pay reserves nothing. A roster change since the form opened gets a 409 the
 * client answers by reloading the options.
 */
export function requireShownPrice(input: {
  readonly priceId: string;
  readonly seatQuantity: number;
  readonly stripe: StripeApiDeps;
}): void {
  const tier = getSyncBillingTierForSeatCount(input.seatQuantity);
  const priceId = tier ? getStripePriceIdForTier(tier.id, input.stripe) : null;
  if (priceId !== input.priceId) {
    throw new OrganizationManagerError(
      "The organization's plan changed; review the new price",
      409,
      BILLING_ERROR_CODES.checkoutPriceChanged,
    );
  }
}

/**
 * An inline attempt rotates when the roster changes under the buyer's unpaid
 * checkout, and the old form would still charge the old tier. Every inline
 * checkout therefore voids the buyer's unpaid checkouts from other attempts
 * before offering its own: any concurrent retry, or a retry after a failed
 * void, retires them again. A request whose own attempt was replaced
 * meanwhile voids nothing. A payment that already went through keeps the
 * 409.
 */
export async function voidOtherInlineCheckouts(input: {
  readonly attemptId: string;
  readonly customerId: string;
  readonly db: ApiDatabase;
  readonly organizationId: string;
  readonly stripe: StripeApiDeps;
}): Promise<void> {
  const voided = await voidStaleInlineCheckouts(
    {
      customerId: input.customerId,
      currentAttemptId: input.attemptId,
      stillReserved: async () =>
        (await readStripeCheckoutAttemptId(input.db, input.organizationId)) ===
        input.attemptId,
    },
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

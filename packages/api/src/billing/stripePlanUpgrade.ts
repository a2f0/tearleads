/** Moves an active subscription to a larger fixed-tier Price, paid now. */

import { z } from "zod";
import {
  providerStringSchema,
  readProviderField,
  readStripeReferenceId,
  stripeReferenceSchema,
} from "./providerPayloadSchema";
import { voidUnpaidInvoice } from "./stripeCheckoutVoid";
import {
  resolveDeps,
  type StripeApiDeps,
  StripeApiError,
  stripeRequest,
} from "./stripeHttp";

type StripePlanUpgradeOutcome = "paid" | "payment-failed";

const upgradeResultSchema = z.looseObject({
  latest_invoice: stripeReferenceSchema,
  pending_update: z.unknown(),
});

const appliedPriceSchema = z.looseObject({
  items: z.looseObject({
    data: z.array(
      z.looseObject({
        id: providerStringSchema,
        price: z.looseObject({ id: providerStringSchema }),
      }),
    ),
  }),
});

/**
 * Switches the subscription's sync item to `priceId` and invoices the
 * prorated difference for the rest of the period at once
 * (`proration_behavior=always_invoice`). With
 * `payment_behavior=pending_if_incomplete` Stripe applies the new Price only
 * once that invoice is paid: a declined payment, or one that needs the
 * buyer's authentication, leaves the Price unchanged with a `pending_update`
 * and an open invoice, which is voided here so it is never charged later.
 *
 * Returns `paid` when the new Price applies, `payment-failed` when nothing
 * changed, and null when Stripe is unconfigured. A response that is neither
 * is a provider failure.
 */
export async function upgradeSubscriptionPlan(
  input: {
    readonly idempotencyKey: string;
    readonly priceId: string;
    readonly subscriptionId: string;
    readonly subscriptionItemId: string;
  },
  deps: StripeApiDeps = {},
): Promise<StripePlanUpgradeOutcome | null> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return null;
  }
  const form = new URLSearchParams();
  form.set("items[0][id]", input.subscriptionItemId);
  form.set("items[0][price]", input.priceId);
  form.set("items[0][quantity]", "1");
  form.set("proration_behavior", "always_invoice");
  form.set("payment_behavior", "pending_if_incomplete");
  const body = await stripeRequest({
    fetchImpl,
    secretKey,
    method: "POST",
    path: `/v1/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
    operation: "subscription plan upgrade",
    form,
    idempotencyKey: input.idempotencyKey,
  });
  const result = readProviderField(upgradeResultSchema, body);
  if (!result) {
    throw new StripeApiError("subscription plan upgrade (unreadable)", 502);
  }
  if (result.pending_update == null) {
    const applied = readProviderField(appliedPriceSchema, body)?.items.data;
    const item = applied?.find(({ id }) => id === input.subscriptionItemId);
    if (item?.price.id !== input.priceId) {
      throw new StripeApiError("subscription plan upgrade (not applied)", 502);
    }
    return "paid";
  }
  const invoiceId = readStripeReferenceId(result.latest_invoice);
  if (!invoiceId || !(await voidUnpaidInvoice(invoiceId, deps))) {
    // Paid after all, between the update and the void: Stripe applies the
    // pending update itself, which a retry then finds already applied.
    throw new StripeApiError("subscription plan upgrade (settling)", 502);
  }
  return "payment-failed";
}

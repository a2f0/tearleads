/**
 * Retires a buyer's unpaid inline checkout so a replacement can be started
 * (services/billing/stripeCheckoutAttempt.ts).
 */

import { z } from "zod";
import {
  readProviderField,
  readStripeReferenceId,
  stripeReferenceSchema,
} from "./providerPayloadSchema";
import { LIVE_SUBSCRIPTION_STATUSES } from "./stripeApi";
import {
  readCheckoutAttemptId,
  subscriptionSearchItemSchema,
} from "./stripeApiSchema";
import {
  resolveDeps,
  type StripeApiDeps,
  StripeApiError,
  stripeRequest,
} from "./stripeHttp";

/** One page holds every subscription a single buyer-and-org customer has. */
const SUBSCRIPTION_PAGE_SIZE = 100;

const subscriptionPageSchema = z.looseObject({
  data: z.array(z.unknown()),
  has_more: z.literal(false),
});

const latestInvoiceSchema = z.looseObject({
  latest_invoice: stripeReferenceSchema,
});

/**
 * Makes the customer's incomplete subscription for `checkoutAttemptId`
 * unpayable by voiding its first invoice, which cancels the PaymentIntent a
 * stale form may still hold and moves the subscription to
 * `incomplete_expired`. Stripe refuses to void an invoice once its payment
 * has succeeded, so a payment racing the replacement wins instead of being
 * undone.
 *
 * Lists the customer's subscriptions rather than searching them: the list is
 * read-after-write consistent, and the search index can lag a subscription
 * created moments ago.
 *
 * Returns true when nothing payable remains for the attempt. Returns false,
 * voiding nothing, when the customer has a live subscription or another
 * attempt's incomplete one, or when the subscriptions cannot be read; and
 * false when Stripe refuses the void.
 */
export async function voidStaleInlineCheckout(
  input: { readonly customerId: string; readonly checkoutAttemptId: string },
  deps: StripeApiDeps = {},
): Promise<boolean> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return false;
  }
  const request = { fetchImpl, secretKey };
  const page = readProviderField(
    subscriptionPageSchema,
    await stripeRequest({
      ...request,
      method: "GET",
      path:
        `/v1/subscriptions?customer=${encodeURIComponent(input.customerId)}` +
        `&status=all&limit=${SUBSCRIPTION_PAGE_SIZE}`,
      operation: "subscription list",
    }),
  );
  const invoiceIds = page
    ? staleCheckoutInvoiceIds(page.data, input.checkoutAttemptId)
    : null;
  if (!invoiceIds) {
    return false;
  }
  for (const invoiceId of invoiceIds) {
    if (!(await voidInvoice(invoiceId, request))) {
      return false;
    }
  }
  return true;
}

/**
 * The first invoices of the attempt's incomplete subscriptions, or null when
 * anything else could still bill this customer or a subscription is
 * unreadable. Terminal subscriptions are skipped.
 */
function staleCheckoutInvoiceIds(
  subscriptions: readonly unknown[],
  checkoutAttemptId: string,
): string[] | null {
  const invoiceIds: string[] = [];
  for (const value of subscriptions) {
    const status = readProviderField(
      subscriptionSearchItemSchema,
      value,
    )?.status;
    if (!status || LIVE_SUBSCRIPTION_STATUSES.has(status)) {
      return null;
    }
    if (status !== "incomplete") {
      continue;
    }
    const invoiceId = readStripeReferenceId(
      readProviderField(latestInvoiceSchema, value)?.latest_invoice,
    );
    if (readCheckoutAttemptId(value) !== checkoutAttemptId || !invoiceId) {
      return null;
    }
    invoiceIds.push(invoiceId);
  }
  return invoiceIds;
}

async function voidInvoice(
  invoiceId: string,
  request: { fetchImpl: typeof fetch; secretKey: string },
): Promise<boolean> {
  try {
    await stripeRequest({
      ...request,
      method: "POST",
      path: `/v1/invoices/${encodeURIComponent(invoiceId)}/void`,
      operation: "checkout invoice void",
    });
    return true;
  } catch (error) {
    // A 4xx is Stripe refusing the void: the payment already succeeded or is
    // otherwise settled. Anything else is a provider failure.
    if (
      error instanceof StripeApiError &&
      error.status >= 400 &&
      error.status < 500
    ) {
      return false;
    }
    throw error;
  }
}

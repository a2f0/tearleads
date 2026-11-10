/**
 * Voids a buyer's unpaid inline checkouts that no longer belong to the
 * organization's reserved attempt, which rotates when the roster changes
 * (services/billing/stripeCheckoutAttempt.ts). Voiding a subscription's
 * first invoice cancels the PaymentIntent a stale form may still hold and
 * moves the subscription to `incomplete_expired`; Stripe refuses to void an
 * invoice once its payment has succeeded, so a payment racing the
 * replacement wins instead of being undone.
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
  subscriptionStatusSchema,
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
 * Voids every incomplete subscription of the buyer's customer except the
 * current attempt's own, which stays resumable. The organization reserves
 * one attempt at a time, so any other attempt's unpaid checkout is stale.
 *
 * Lists the customer's subscriptions rather than searching them: the list is
 * read-after-write consistent, and the search index can lag a subscription
 * created moments ago.
 *
 * Returns true when nothing but the current attempt's checkout remains
 * payable. Returns false, voiding nothing, when the customer has a live
 * subscription or the subscriptions cannot be read; and false when Stripe
 * refuses a void.
 */
export async function voidStaleInlineCheckouts(
  input: { readonly customerId: string; readonly currentAttemptId: string },
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
    ? staleCheckoutInvoiceIds(page.data, input.currentAttemptId)
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
 * The first invoices of every other attempt's incomplete subscription, or
 * null when a live subscription could already bill this customer or a
 * subscription is unreadable. Terminal subscriptions are skipped.
 */
function staleCheckoutInvoiceIds(
  subscriptions: readonly unknown[],
  currentAttemptId: string,
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
    if (
      status !== "incomplete" ||
      readCheckoutAttemptId(value) === currentAttemptId
    ) {
      continue;
    }
    const invoiceId = readStripeReferenceId(
      readProviderField(latestInvoiceSchema, value)?.latest_invoice,
    );
    if (!invoiceId) {
      return null;
    }
    invoiceIds.push(invoiceId);
  }
  return invoiceIds;
}

/**
 * Voids the incomplete subscription a checkout created or resumed for an
 * attempt that was replaced meanwhile, before its client secret reaches the
 * buyer. A subscription that is no longer incomplete is left alone.
 */
export async function voidReplacedCheckout(
  subscriptionId: string,
  deps: StripeApiDeps = {},
): Promise<void> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return;
  }
  const request = { fetchImpl, secretKey };
  const subscription = await stripeRequest({
    ...request,
    method: "GET",
    path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    operation: "replaced checkout inspect",
  });
  const status = readProviderField(
    subscriptionSearchItemSchema,
    subscription,
  )?.status;
  const invoiceId = readStripeReferenceId(
    readProviderField(latestInvoiceSchema, subscription)?.latest_invoice,
  );
  if (status === "incomplete" && invoiceId) {
    await voidInvoice(invoiceId, request);
  }
}

/**
 * True once the invoice is void, including when a concurrent request voided
 * it first; false when Stripe refuses because the payment won.
 */
async function voidInvoice(
  invoiceId: string,
  request: { fetchImpl: typeof fetch; secretKey: string },
): Promise<boolean> {
  const path = `/v1/invoices/${encodeURIComponent(invoiceId)}`;
  try {
    await stripeRequest({
      ...request,
      method: "POST",
      path: `${path}/void`,
      operation: "checkout invoice void",
    });
    return true;
  } catch (error) {
    // A 4xx is Stripe refusing the void; anything else is a provider failure.
    if (
      !(error instanceof StripeApiError) ||
      error.status < 400 ||
      error.status >= 500
    ) {
      throw error;
    }
  }
  const invoice = await stripeRequest({
    ...request,
    method: "GET",
    path,
    operation: "checkout invoice inspect",
  });
  return (
    readProviderField(subscriptionStatusSchema, invoice)?.status === "void"
  );
}

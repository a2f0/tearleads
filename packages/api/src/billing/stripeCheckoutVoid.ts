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
  stripeObjectIdSchema,
  subscriptionSearchItemSchema,
  subscriptionStatusSchema,
} from "./stripeApiSchema";
import {
  resolveDeps,
  type StripeApiDeps,
  StripeApiError,
  stripeRequest,
} from "./stripeHttp";

interface StripeRequestAuth {
  readonly fetchImpl: typeof fetch;
  readonly secretKey: string;
}

const SUBSCRIPTION_PAGE_SIZE = 100;
/** Bound provider work while covering up to 10,000 subscriptions. */
const MAX_SUBSCRIPTION_PAGES = 100;

const subscriptionPageSchema = z.looseObject({
  data: z.array(z.unknown()),
  has_more: z.boolean(),
});

const latestInvoiceSchema = z.looseObject({
  latest_invoice: stripeReferenceSchema,
});

/**
 * Voids every incomplete subscription of the buyer's customer except the
 * current attempt's own, which stays resumable. The organization reserves
 * one attempt at a time, so any other attempt's unpaid checkout is stale —
 * but only while the current attempt is still the reserved one, which
 * `stillReserved` confirms after listing: a request whose attempt was
 * replaced meanwhile would otherwise void its replacement's checkout.
 *
 * Lists the customer's subscriptions rather than searching them: the list is
 * read-after-write consistent, and the search index can lag a subscription
 * created moments ago.
 *
 * Returns true when nothing but the current attempt's checkout remains
 * payable. Returns false, voiding nothing, when the customer has a live
 * subscription, the subscriptions cannot be read, or the attempt is no
 * longer reserved; and false when Stripe refuses a void.
 */
export async function voidStaleInlineCheckouts(
  input: {
    readonly customerId: string;
    readonly currentAttemptId: string;
    readonly stillReserved: () => Promise<boolean>;
  },
  deps: StripeApiDeps = {},
): Promise<boolean> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return false;
  }
  const request = { fetchImpl, secretKey };
  const subscriptions = await listCustomerSubscriptions(
    input.customerId,
    request,
  );
  const invoiceIds = subscriptions
    ? staleCheckoutInvoiceIds(subscriptions, input.currentAttemptId)
    : null;
  if (!invoiceIds) {
    return false;
  }
  // Everything listed predates the check: an attempt still reserved now was
  // reserved when the list was read, so nothing listed is its replacement's.
  if (invoiceIds.length > 0 && !(await input.stillReserved())) {
    return false;
  }
  for (const invoiceId of invoiceIds) {
    if (!(await voidInvoice(invoiceId, request))) {
      return false;
    }
  }
  return true;
}

/** Every subscription of the customer, or null when a page is unreadable. */
async function listCustomerSubscriptions(
  customerId: string,
  request: StripeRequestAuth,
): Promise<unknown[] | null> {
  const subscriptions: unknown[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_SUBSCRIPTION_PAGES; page += 1) {
    const body = readProviderField(
      subscriptionPageSchema,
      await stripeRequest({
        ...request,
        method: "GET",
        path:
          `/v1/subscriptions?customer=${encodeURIComponent(customerId)}` +
          `&status=all&limit=${SUBSCRIPTION_PAGE_SIZE}${cursor}`,
        operation: "subscription list",
      }),
    );
    if (!body) {
      return null;
    }
    subscriptions.push(...body.data);
    if (!body.has_more) {
      return subscriptions;
    }
    const lastId = readProviderField(
      stripeObjectIdSchema,
      body.data.at(-1),
    )?.id;
    if (!lastId) {
      return null;
    }
    cursor = `&starting_after=${encodeURIComponent(lastId)}`;
  }
  return null;
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
  request: StripeRequestAuth,
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
    // A 4xx is Stripe refusing the void. A rate limit and anything else is a
    // provider failure, not a refusal.
    if (
      !(error instanceof StripeApiError) ||
      error.status < 400 ||
      error.status >= 500 ||
      error.status === 429
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

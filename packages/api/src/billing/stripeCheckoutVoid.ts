/**
 * Retires a buyer's unpaid checkouts that no longer belong to the
 * organization's reserved attempt, which rotates when the buyer chooses
 * another plan or another way to pay (services/billing/stripeCheckoutAttempt.ts).
 *
 * - Inline: voiding a subscription's first invoice cancels the PaymentIntent
 *   a stale form may still hold and moves the subscription to
 *   `incomplete_expired`; Stripe refuses to void an invoice once its payment
 *   has succeeded.
 * - Hosted: an expired Checkout Session can no longer be paid; Stripe refuses
 *   to expire one that has completed.
 *
 * Either way a payment racing the replacement wins instead of being undone.
 */

import { z } from "zod";
import {
  providerStringSchema,
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

const PAGE_SIZE = 100;
/** Bound provider work while covering up to 10,000 objects. */
const MAX_PAGES = 100;
/**
 * A Session completed this recently may still be settling its payment, so it
 * holds a replacement off: the hosted attempt's lifetime.
 */
const SETTLING_SESSION_MS = 50 * 60 * 1_000;

const pageSchema = z.looseObject({
  data: z.array(z.unknown()),
  has_more: z.boolean(),
});

const latestInvoiceSchema = z.looseObject({
  latest_invoice: stripeReferenceSchema,
});

const checkoutSessionSchema = z.looseObject({
  created: z.number(),
  id: providerStringSchema,
  status: providerStringSchema,
});

interface StaleCheckoutInput {
  readonly customerId: string;
  readonly currentAttemptId: string;
  readonly stillReserved: () => Promise<boolean>;
}

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
  input: StaleCheckoutInput,
  deps: StripeApiDeps = {},
): Promise<boolean> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return false;
  }
  const request = { fetchImpl, secretKey };
  const subscriptions = await listCustomerObjects(
    `/v1/subscriptions?customer=${encodeURIComponent(input.customerId)}&status=all`,
    "subscription list",
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

/**
 * Expires every open hosted Checkout Session of the buyer's customer except
 * the current attempt's own (its `metadata.checkoutAttemptId`), under the
 * same `stillReserved` rule as {@link voidStaleInlineCheckouts}: a buyer who
 * left Stripe's page, or abandoned it before it opened, can then pay another
 * way or for another plan without waiting for the Session to lapse.
 *
 * Returns true when no other attempt's Session remains payable. Returns
 * false, expiring nothing, when the Sessions cannot be read, another
 * attempt's Session completed recently enough that its payment may still be
 * settling, or the attempt is no longer reserved; and false when Stripe
 * refuses an expiry because that Session completed meanwhile.
 */
export async function expireStaleCheckoutSessions(
  input: StaleCheckoutInput & { readonly now: Date },
  deps: StripeApiDeps = {},
): Promise<boolean> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  if (!secretKey) {
    return false;
  }
  const request = { fetchImpl, secretKey };
  const sessions = await listCustomerObjects(
    `/v1/checkout/sessions?customer=${encodeURIComponent(input.customerId)}`,
    "checkout session list",
    request,
  );
  const sessionIds = sessions
    ? staleOpenSessionIds(sessions, input.currentAttemptId, input.now)
    : null;
  if (!sessionIds) {
    return false;
  }
  if (sessionIds.length > 0 && !(await input.stillReserved())) {
    return false;
  }
  for (const sessionId of sessionIds) {
    if (!(await expireSession(sessionId, request))) {
      return false;
    }
  }
  return true;
}

/**
 * Expires one hosted Checkout Session, for a request whose attempt was
 * replaced while it was creating the Session. True once it is expired.
 */
export async function expireCheckoutSession(
  sessionId: string,
  deps: StripeApiDeps = {},
): Promise<boolean> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  return secretKey ? expireSession(sessionId, { fetchImpl, secretKey }) : false;
}

/**
 * Voids an unpaid invoice so it can never be charged, for an upgrade whose
 * prorated charge did not go through. True once it is void; false when
 * Stripe refuses because it was paid meanwhile.
 */
export async function voidUnpaidInvoice(
  invoiceId: string,
  deps: StripeApiDeps = {},
): Promise<boolean> {
  const { fetchImpl, secretKey } = resolveDeps(deps);
  return secretKey ? voidInvoice(invoiceId, { fetchImpl, secretKey }) : false;
}

/** Every listed object of the customer, or null when a page is unreadable. */
async function listCustomerObjects(
  path: string,
  operation: string,
  request: StripeRequestAuth,
): Promise<unknown[] | null> {
  const objects: unknown[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = readProviderField(
      pageSchema,
      await stripeRequest({
        ...request,
        method: "GET",
        path: `${path}&limit=${PAGE_SIZE}${cursor}`,
        operation,
      }),
    );
    if (!body) {
      return null;
    }
    objects.push(...body.data);
    if (!body.has_more) {
      return objects;
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
 * Every other attempt's open Session, or null when a Session is unreadable
 * or another attempt's Session completed within the settling window.
 * Expired and long-settled Sessions are skipped.
 */
function staleOpenSessionIds(
  sessions: readonly unknown[],
  currentAttemptId: string,
  now: Date,
): string[] | null {
  const sessionIds: string[] = [];
  for (const value of sessions) {
    const session = readProviderField(checkoutSessionSchema, value);
    if (!session) {
      return null;
    }
    if (readCheckoutAttemptId(value) === currentAttemptId) {
      continue;
    }
    if (session.status === "open") {
      sessionIds.push(session.id);
    } else if (
      session.status === "complete" &&
      now.getTime() - session.created * 1_000 < SETTLING_SESSION_MS
    ) {
      return null;
    }
  }
  return sessionIds;
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
function voidInvoice(
  invoiceId: string,
  request: StripeRequestAuth,
): Promise<boolean> {
  return retire(
    {
      path: `/v1/invoices/${encodeURIComponent(invoiceId)}`,
      action: "void",
      operation: "checkout invoice",
      retired: "void",
    },
    request,
  );
}

/**
 * True once the Session is expired, including when a concurrent request
 * expired it first; false when Stripe refuses because it completed.
 */
function expireSession(
  sessionId: string,
  request: StripeRequestAuth,
): Promise<boolean> {
  return retire(
    {
      path: `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      action: "expire",
      operation: "checkout session",
      retired: "expired",
    },
    request,
  );
}

/**
 * Posts the retiring action, and after a refusal reads the object back: it
 * is retired when its status is `retired`, as when a concurrent request
 * retired it first.
 */
async function retire(
  target: {
    readonly action: string;
    readonly operation: string;
    readonly path: string;
    readonly retired: string;
  },
  request: StripeRequestAuth,
): Promise<boolean> {
  try {
    await stripeRequest({
      ...request,
      method: "POST",
      path: `${target.path}/${target.action}`,
      operation: `${target.operation} ${target.action}`,
    });
    return true;
  } catch (error) {
    // A 4xx is Stripe refusing the action. A rate limit and anything else is
    // a provider failure, not a refusal.
    if (
      !(error instanceof StripeApiError) ||
      error.status < 400 ||
      error.status >= 500 ||
      error.status === 429
    ) {
      throw error;
    }
  }
  const current = await stripeRequest({
    ...request,
    method: "GET",
    path: target.path,
    operation: `${target.operation} inspect`,
  });
  return (
    readProviderField(subscriptionStatusSchema, current)?.status ===
    target.retired
  );
}

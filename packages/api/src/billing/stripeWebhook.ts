import { createHmac, timingSafeEqual } from "node:crypto";
import { prop, readString } from "./stripeHttp";

/**
 * Stripe webhook verification and event extraction for the direct web
 * checkout (issue #1654). Initial paid invoices trigger the RevenueCat
 * association; renewal invoices advance the durable Stripe seat period.
 * RevenueCat still mirrors entitlement lifecycle events after association.
 */

/** Environment variable holding the Stripe webhook signing secret (`whsec_…`). */
const STRIPE_WEBHOOK_SECRET_ENV = "STRIPE_WEBHOOK_SECRET";

/**
 * Reject events whose signature timestamp is older than this. Stripe signs
 * `${timestamp}.${payload}`, so the tolerance bounds replay of a captured
 * delivery.
 */
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export function readStripeWebhookSecret(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const secret = env[STRIPE_WEBHOOK_SECRET_ENV]?.trim();
  return secret ? secret : null;
}

/**
 * Verifies a `Stripe-Signature` header against the raw request body: HMAC
 * SHA-256 of `${t}.${payload}` with the endpoint secret must match one of the
 * `v1` signatures, and `t` must be within the replay tolerance. Comparison is
 * constant-time. Never throws — an unverifiable delivery is just `false`.
 */
export function verifyStripeSignature(input: {
  payload: string;
  signatureHeader: string | undefined;
  secret: string;
  nowMs?: number;
}): boolean {
  if (!input.signatureHeader) {
    return false;
  }
  const parts = new Map<string, string[]>();
  for (const pair of input.signatureHeader.split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    parts.set(key, [...(parts.get(key) ?? []), value]);
  }
  const timestamp = Number(parts.get("t")?.[0]);
  const signatures = parts.get("v1") ?? [];
  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    return false;
  }
  const nowMs = input.nowMs ?? Date.now();
  if (Math.abs(nowMs - timestamp * 1000) > SIGNATURE_TOLERANCE_MS) {
    return false;
  }
  const expected = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.payload}`)
    .digest();
  return signatures.some((signature) => {
    const presented = Buffer.from(signature, "hex");
    return (
      presented.length === expected.length &&
      timingSafeEqual(presented, expected)
    );
  });
}

/**
 * Extracts the subscription id from an `invoice.paid` event for a NEW
 * subscription (`billing_reason: subscription_create`); null for every other
 * event. The invoice's subscription reference moved between Stripe API
 * versions — top-level `subscription` (string or expanded object) vs.
 * `parent.subscription_details.subscription` — and the webhook payload's shape
 * follows the ACCOUNT's default version rather than the version this server
 * pins on its own calls, so both shapes are read. The subscription's
 * authoritative metadata is then fetched separately (stripeApi
 * `getSubscriptionBinding`) rather than trusted from the event.
 */
export function extractPaidSubscriptionId(event: unknown): string | null {
  const invoice = extractPaidSubscriptionInvoice(event);
  return invoice?.billingReason === "subscription_create"
    ? invoice.subscriptionId
    : null;
}

interface StripePaidSubscriptionInvoice {
  readonly billingReason: "subscription_create" | "subscription_cycle";
  readonly invoiceId: string | null;
  readonly subscriptionId: string;
}

/** Extracts initial and renewal paid invoices for direct Stripe billing. */
export function extractPaidSubscriptionInvoice(
  event: unknown,
): StripePaidSubscriptionInvoice | null {
  if (readString(prop(event, "type")) !== "invoice.paid") {
    return null;
  }
  const invoice = prop(prop(event, "data"), "object");
  const billingReason = readString(prop(invoice, "billing_reason"));
  if (
    billingReason !== "subscription_create" &&
    billingReason !== "subscription_cycle"
  ) {
    return null;
  }
  const subscription = prop(invoice, "subscription");
  const direct =
    readString(subscription) ?? readString(prop(subscription, "id"));
  if (direct) {
    return {
      billingReason,
      invoiceId: readString(prop(invoice, "id")),
      subscriptionId: direct,
    };
  }
  const details = prop(prop(invoice, "parent"), "subscription_details");
  const nested = prop(details, "subscription");
  const subscriptionId = readString(nested) ?? readString(prop(nested, "id"));
  return subscriptionId
    ? {
        billingReason,
        invoiceId: readString(prop(invoice, "id")),
        subscriptionId,
      }
    : null;
}

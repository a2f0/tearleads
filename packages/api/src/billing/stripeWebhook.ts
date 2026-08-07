import { createHmac, timingSafeEqual } from "node:crypto";
import {
  prop,
  readNonnegativeInteger,
  readPositiveInteger,
  readString,
  readUnixTimestamp,
} from "./stripeHttp";

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

export type StripeInvoiceBillingReason =
  | "automatic_pending_invoice_item_invoice"
  | "manual"
  | "quote_accept"
  | "subscription"
  | "subscription_create"
  | "subscription_cycle"
  | "subscription_threshold"
  | "subscription_update"
  | "upcoming";

export interface StripePaidInvoiceLineSnapshot {
  readonly currency: string | null;
  readonly id: string | null;
  readonly interval: string | null;
  readonly intervalCount: number | null;
  readonly periodEndsAt: Date | null;
  readonly periodStartsAt: Date | null;
  readonly priceId: string | null;
  readonly proration: boolean | null;
  readonly quantity: number | null;
  readonly subscriptionId: string | null;
  readonly subscriptionItemId: string | null;
  readonly unitAmount: number | null;
}

export interface StripePaidSubscriptionInvoice {
  readonly amountPaid: number | null;
  readonly billingReason: StripeInvoiceBillingReason;
  readonly currency: string | null;
  readonly invoiceId: string | null;
  readonly lines: readonly StripePaidInvoiceLineSnapshot[];
  readonly linesHasMore: boolean | null;
  readonly occurredAt: Date;
  readonly providerEventId: string | null;
  readonly subscriptionId: string;
}

interface StripePaidInvoiceLineListSnapshot {
  readonly hasMore: boolean | null;
  readonly lines: readonly StripePaidInvoiceLineSnapshot[];
}

function readUnitAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return readNonnegativeInteger(value);
  }
  if (typeof value !== "string" || !/^\d+(?:\.0+)?$/.test(value)) {
    return null;
  }
  return readNonnegativeInteger(Number(value));
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readResourceId(value: unknown): string | null {
  return readString(value) ?? readString(prop(value, "id"));
}

function readBillingReason(value: unknown): StripeInvoiceBillingReason | null {
  switch (readString(value)) {
    case "automatic_pending_invoice_item_invoice":
      return "automatic_pending_invoice_item_invoice";
    case "manual":
      return "manual";
    case "quote_accept":
      return "quote_accept";
    case "subscription":
      return "subscription";
    case "subscription_create":
      return "subscription_create";
    case "subscription_cycle":
      return "subscription_cycle";
    case "subscription_threshold":
      return "subscription_threshold";
    case "subscription_update":
      return "subscription_update";
    case "upcoming":
      return "upcoming";
    default:
      return null;
  }
}

function firstPresent<T>(
  values: readonly unknown[],
  reader: (value: unknown) => T | null,
): T | null {
  for (const value of values) {
    const parsed = reader(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function readIntervalCount(recurringPrices: readonly unknown[]): number | null {
  return firstPresent(
    recurringPrices.map((recurring) => prop(recurring, "interval_count")),
    readPositiveInteger,
  );
}

function extractPaidInvoiceLine(line: unknown): StripePaidInvoiceLineSnapshot {
  const oldPrice = prop(line, "price");
  const pricing = prop(line, "pricing");
  const priceDetails = prop(pricing, "price_details");
  const currentPrice = prop(priceDetails, "price");
  const parent = prop(line, "parent");
  const subscriptionItemDetails = prop(parent, "subscription_item_details");
  const invoiceItemDetails = prop(parent, "invoice_item_details");
  const oldRecurring = prop(oldPrice, "recurring");
  const currentRecurring = prop(currentPrice, "recurring");
  const priceDetailsRecurring = prop(priceDetails, "recurring");
  const period = prop(line, "period");

  return {
    currency: firstPresent(
      [
        prop(line, "currency"),
        prop(oldPrice, "currency"),
        prop(currentPrice, "currency"),
        prop(priceDetails, "currency"),
      ],
      readString,
    ),
    id: readString(prop(line, "id")),
    interval: firstPresent(
      [
        prop(oldRecurring, "interval"),
        prop(currentRecurring, "interval"),
        prop(priceDetailsRecurring, "interval"),
      ],
      readString,
    ),
    intervalCount: readIntervalCount([
      oldRecurring,
      currentRecurring,
      priceDetailsRecurring,
    ]),
    periodEndsAt: readUnixTimestamp(prop(period, "end")),
    periodStartsAt: readUnixTimestamp(prop(period, "start")),
    priceId: firstPresent([oldPrice, currentPrice], readResourceId),
    proration: firstPresent(
      [
        prop(line, "proration"),
        prop(subscriptionItemDetails, "proration"),
        prop(invoiceItemDetails, "proration"),
      ],
      readBoolean,
    ),
    quantity: readPositiveInteger(prop(line, "quantity")),
    subscriptionId: firstPresent(
      [
        prop(line, "subscription"),
        prop(subscriptionItemDetails, "subscription"),
        prop(invoiceItemDetails, "subscription"),
      ],
      readResourceId,
    ),
    subscriptionItemId: firstPresent(
      [
        prop(line, "subscription_item"),
        prop(subscriptionItemDetails, "subscription_item"),
        prop(invoiceItemDetails, "subscription_item"),
      ],
      readResourceId,
    ),
    unitAmount: firstPresent(
      [
        prop(oldPrice, "unit_amount"),
        prop(oldPrice, "unit_amount_decimal"),
        prop(pricing, "unit_amount_decimal"),
        prop(priceDetails, "unit_amount_decimal"),
        prop(currentPrice, "unit_amount"),
        prop(currentPrice, "unit_amount_decimal"),
      ],
      readUnitAmount,
    ),
  };
}

/** Parses either an invoice's embedded `lines` or a Stripe line-list page. */
export function extractPaidInvoiceLineList(
  value: unknown,
): StripePaidInvoiceLineListSnapshot {
  const embeddedLines = prop(value, "lines");
  const lineList = embeddedLines === undefined ? value : embeddedLines;
  const data = prop(lineList, "data");
  return {
    hasMore: readBoolean(prop(lineList, "has_more")),
    lines: Array.isArray(data) ? data.map(extractPaidInvoiceLine) : [],
  };
}

/** Extracts a paid invoice tied to a direct Stripe subscription. */
export function extractPaidSubscriptionInvoice(
  event: unknown,
  processingTime: Date = new Date(),
): StripePaidSubscriptionInvoice | null {
  if (readString(prop(event, "type")) !== "invoice.paid") {
    return null;
  }
  const invoice = prop(prop(event, "data"), "object");
  const billingReason = readBillingReason(prop(invoice, "billing_reason"));
  if (!billingReason) {
    return null;
  }
  const lineList = extractPaidInvoiceLineList(invoice);
  const shared: Omit<StripePaidSubscriptionInvoice, "subscriptionId"> = {
    amountPaid: readNonnegativeInteger(prop(invoice, "amount_paid")),
    billingReason,
    currency: readString(prop(invoice, "currency")),
    invoiceId: readString(prop(invoice, "id")),
    lines: lineList.lines,
    linesHasMore: lineList.hasMore,
    occurredAt:
      readUnixTimestamp(prop(prop(invoice, "status_transitions"), "paid_at")) ??
      readUnixTimestamp(prop(event, "created")) ??
      processingTime,
    providerEventId: readString(prop(event, "id")),
  };
  const subscription = prop(invoice, "subscription");
  const direct =
    readString(subscription) ?? readString(prop(subscription, "id"));
  if (direct) {
    return {
      ...shared,
      subscriptionId: direct,
    };
  }
  const details = prop(prop(invoice, "parent"), "subscription_details");
  const nested = prop(details, "subscription");
  const subscriptionId = readString(nested) ?? readString(prop(nested, "id"));
  return subscriptionId
    ? {
        ...shared,
        subscriptionId,
      }
    : null;
}

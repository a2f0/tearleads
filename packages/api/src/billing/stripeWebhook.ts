import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  nonnegativeIntegerSchema,
  positiveIntegerSchema,
  readProviderField,
  readProviderObject,
  readProviderString,
  readStripeReferenceId,
  readUnixTimestamp,
} from "./providerPayloadSchema";
import {
  billingReasonSchema,
  embeddedLinesSchema,
  eventDataSchema,
  invoiceFieldsSchema,
  invoiceLineFieldsSchema,
  invoiceParentSubscriptionSchema,
  lineItemDetailsSchema,
  lineListDataSchema,
  lineListHasMoreSchema,
  lineParentSchema,
  linePeriodSchema,
  linePriceDetailsSchema,
  linePriceSchema,
  linePricingSchema,
  paidEventFieldsSchema,
  paidEventSchema,
  recurringFieldsSchema,
  statusTransitionsSchema,
  unitAmountDecimalSchema,
} from "./stripeWebhookSchema";

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

export type StripeInvoiceBillingReason = z.output<typeof billingReasonSchema>;

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

function readBoolean(value: unknown): boolean | null {
  return readProviderField(z.boolean(), value);
}

/** An integer amount, or a decimal string whose fraction is all zeros. */
function readUnitAmount(value: unknown): number | null {
  const decimal = readProviderField(unitAmountDecimalSchema, value);
  return readProviderField(
    nonnegativeIntegerSchema,
    decimal === null ? value : Number(decimal),
  );
}

function readPositiveInteger(value: unknown): number | null {
  return readProviderField(positiveIntegerSchema, value);
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

function extractPaidInvoiceLine(value: unknown): StripePaidInvoiceLineSnapshot {
  const line = readProviderObject(invoiceLineFieldsSchema, value);
  const oldPrice = readProviderObject(linePriceSchema, line.price);
  const pricing = readProviderObject(linePricingSchema, line.pricing);
  const priceDetails = readProviderObject(
    linePriceDetailsSchema,
    pricing.price_details,
  );
  const currentPrice = readProviderObject(linePriceSchema, priceDetails.price);
  const parent = readProviderObject(lineParentSchema, line.parent);
  const subscriptionItemDetails = readProviderObject(
    lineItemDetailsSchema,
    parent.subscription_item_details,
  );
  const invoiceItemDetails = readProviderObject(
    lineItemDetailsSchema,
    parent.invoice_item_details,
  );
  const recurrings = [
    oldPrice.recurring,
    currentPrice.recurring,
    priceDetails.recurring,
  ].map((recurring) => readProviderObject(recurringFieldsSchema, recurring));
  const period = readProviderObject(linePeriodSchema, line.period);
  const itemDetails = [line, subscriptionItemDetails, invoiceItemDetails];

  return {
    currency: firstPresent(
      [
        line.currency,
        oldPrice.currency,
        currentPrice.currency,
        priceDetails.currency,
      ],
      readProviderString,
    ),
    id: readProviderString(line.id),
    interval: firstPresent(
      recurrings.map((recurring) => recurring.interval),
      readProviderString,
    ),
    intervalCount: firstPresent(
      recurrings.map((recurring) => recurring.interval_count),
      readPositiveInteger,
    ),
    periodEndsAt: readUnixTimestamp(period.end),
    periodStartsAt: readUnixTimestamp(period.start),
    priceId: firstPresent(
      [line.price, priceDetails.price],
      readStripeReferenceId,
    ),
    proration: firstPresent(
      itemDetails.map((details) => details.proration),
      readBoolean,
    ),
    quantity: readPositiveInteger(line.quantity),
    subscriptionId: firstPresent(
      itemDetails.map((details) => details.subscription),
      readStripeReferenceId,
    ),
    subscriptionItemId: firstPresent(
      itemDetails.map((details) => details.subscription_item),
      readStripeReferenceId,
    ),
    unitAmount: firstPresent(
      [
        oldPrice.unit_amount,
        oldPrice.unit_amount_decimal,
        pricing.unit_amount_decimal,
        priceDetails.unit_amount_decimal,
        currentPrice.unit_amount,
        currentPrice.unit_amount_decimal,
      ],
      readUnitAmount,
    ),
  };
}

/** Parses either an invoice's embedded `lines` or a Stripe line-list page. */
export function extractPaidInvoiceLineList(
  value: unknown,
): StripePaidInvoiceLineListSnapshot {
  const embeddedLines = readProviderObject(embeddedLinesSchema, value).lines;
  const lineList = embeddedLines === undefined ? value : embeddedLines;
  return {
    hasMore:
      readProviderField(lineListHasMoreSchema, lineList)?.has_more ?? null,
    lines:
      readProviderField(lineListDataSchema, lineList)?.data.map(
        extractPaidInvoiceLine,
      ) ?? [],
  };
}

/** Extracts a paid invoice tied to a direct Stripe subscription. */
export function extractPaidSubscriptionInvoice(
  event: unknown,
  processingTime: Date = new Date(),
): StripePaidSubscriptionInvoice | null {
  if (!paidEventSchema.safeParse(event).success) {
    return null;
  }
  const eventFields = readProviderObject(paidEventFieldsSchema, event);
  const invoiceValue = readProviderObject(
    eventDataSchema,
    eventFields.data,
  ).object;
  const invoice = readProviderObject(invoiceFieldsSchema, invoiceValue);
  const billingReason = readProviderField(
    billingReasonSchema,
    invoice.billing_reason,
  );
  if (!billingReason) {
    return null;
  }
  const lineList = extractPaidInvoiceLineList(invoiceValue);
  const shared: Omit<StripePaidSubscriptionInvoice, "subscriptionId"> = {
    amountPaid: readProviderField(
      nonnegativeIntegerSchema,
      invoice.amount_paid,
    ),
    billingReason,
    currency: readProviderString(invoice.currency),
    invoiceId: readProviderString(invoice.id),
    lines: lineList.lines,
    linesHasMore: lineList.hasMore,
    occurredAt:
      readUnixTimestamp(
        readProviderObject(statusTransitionsSchema, invoice.status_transitions)
          .paid_at,
      ) ??
      readUnixTimestamp(eventFields.created) ??
      processingTime,
    providerEventId: readProviderString(eventFields.id),
  };
  const subscriptionId =
    readStripeReferenceId(invoice.subscription) ??
    readStripeReferenceId(
      readProviderField(invoiceParentSubscriptionSchema, invoice.parent)
        ?.subscription_details.subscription,
    );
  return subscriptionId ? { ...shared, subscriptionId } : null;
}

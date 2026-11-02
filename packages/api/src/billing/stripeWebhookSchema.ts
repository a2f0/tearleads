/**
 * Loose shapes of the Stripe invoice data stripeWebhook.ts snapshots, from a
 * verified `invoice.paid` event or an invoice/line-list response. Fields are
 * typed `providerFieldSchema` and parsed one by one by their readers, so one
 * malformed field reads as null without hiding its siblings. Invoice and line
 * shapes moved between Stripe API versions, and the webhook follows the
 * account's default version, so both layouts are described.
 */

import { z } from "zod";
import { providerFieldSchema } from "./providerPayloadSchema";

export const paidEventSchema = z.looseObject({
  type: z.literal("invoice.paid"),
});

export const paidEventFieldsSchema = z.looseObject({
  created: providerFieldSchema,
  data: providerFieldSchema,
  id: providerFieldSchema,
});

export const eventDataSchema = z.looseObject({ object: providerFieldSchema });

export const billingReasonSchema = z.enum([
  "automatic_pending_invoice_item_invoice",
  "manual",
  "quote_accept",
  "subscription",
  "subscription_create",
  "subscription_cycle",
  "subscription_threshold",
  "subscription_update",
  "upcoming",
]);

export const invoiceFieldsSchema = z.looseObject({
  amount_paid: providerFieldSchema,
  billing_reason: providerFieldSchema,
  currency: providerFieldSchema,
  id: providerFieldSchema,
  parent: providerFieldSchema,
  status_transitions: providerFieldSchema,
  subscription: providerFieldSchema,
});

export const statusTransitionsSchema = z.looseObject({
  paid_at: providerFieldSchema,
});

/** Newer API versions nest the subscription under the invoice's parent. */
export const invoiceParentSubscriptionSchema = z.looseObject({
  subscription_details: z.looseObject({ subscription: providerFieldSchema }),
});

export const embeddedLinesSchema = z.looseObject({
  lines: providerFieldSchema,
});

export const lineListDataSchema = z.looseObject({
  data: z.array(z.unknown()),
});

export const lineListHasMoreSchema = z.looseObject({
  has_more: z.boolean(),
});

export const invoiceLineFieldsSchema = z.looseObject({
  currency: providerFieldSchema,
  id: providerFieldSchema,
  parent: providerFieldSchema,
  period: providerFieldSchema,
  price: providerFieldSchema,
  pricing: providerFieldSchema,
  proration: providerFieldSchema,
  quantity: providerFieldSchema,
  subscription: providerFieldSchema,
  subscription_item: providerFieldSchema,
});

/** A line's `price` (older versions) or `pricing.price_details.price`. */
export const linePriceSchema = z.looseObject({
  currency: providerFieldSchema,
  recurring: providerFieldSchema,
  unit_amount: providerFieldSchema,
  unit_amount_decimal: providerFieldSchema,
});

export const linePricingSchema = z.looseObject({
  price_details: providerFieldSchema,
  unit_amount_decimal: providerFieldSchema,
});

export const linePriceDetailsSchema = z.looseObject({
  currency: providerFieldSchema,
  price: providerFieldSchema,
  recurring: providerFieldSchema,
  unit_amount_decimal: providerFieldSchema,
});

export const recurringFieldsSchema = z.looseObject({
  interval: providerFieldSchema,
  interval_count: providerFieldSchema,
});

export const lineParentSchema = z.looseObject({
  invoice_item_details: providerFieldSchema,
  subscription_item_details: providerFieldSchema,
});

export const lineItemDetailsSchema = z.looseObject({
  proration: providerFieldSchema,
  subscription: providerFieldSchema,
  subscription_item: providerFieldSchema,
});

export const linePeriodSchema = z.looseObject({
  end: providerFieldSchema,
  start: providerFieldSchema,
});

/** A whole number of minor units, optionally written with a zero fraction. */
export const unitAmountDecimalSchema = z.string().regex(/^\d+(?:\.0+)?$/);

import { z } from "zod";
import { SyncBillingTierIdSchema } from "../billing";
import {
  arraySchema,
  boundedPositiveIntegerSchema,
  loosePlainObject,
  nonEmptyStringSchema,
} from "../schema";

/**
 * Responses for direct Stripe checkout. Amounts remain in the currency's minor
 * unit exactly as Stripe reports them; clients own display formatting.
 */

/** One purchasable sync option, shaped for display in the billing panel. */
export const StripeSyncOptionResponseSchema = loosePlainObject({
  tierId: SyncBillingTierIdSchema,
  seatLimit: boundedPositiveIntegerSchema(Number.MAX_SAFE_INTEGER),
  priceId: nonEmptyStringSchema,
  productName: nonEmptyStringSchema,
  currency: nonEmptyStringSchema,
  /** Amount in the currency's minor unit; null if unpriced. */
  unitAmount: z.number().nullable(),
  /** Billing interval; null for a non-recurring price. */
  interval: z.string().nullable(),
  /** Number of intervals in one billing period; null when Stripe omits it. */
  intervalCount: boundedPositiveIntegerSchema(
    Number.MAX_SAFE_INTEGER,
  ).nullable(),
});

export type StripeSyncOptionResponse = z.infer<
  typeof StripeSyncOptionResponseSchema
>;

export const StripeCheckoutOptionsResponseSchema = loosePlainObject({
  options: arraySchema(StripeSyncOptionResponseSchema),
});

export type StripeCheckoutOptionsResponse = z.infer<
  typeof StripeCheckoutOptionsResponseSchema
>;

/** What the Payment Element needs to confirm one purchase. */
export const StripeCheckoutIntentResponseSchema = loosePlainObject({
  subscriptionId: nonEmptyStringSchema,
  clientSecret: nonEmptyStringSchema,
});

export type StripeCheckoutIntentResponse = z.infer<
  typeof StripeCheckoutIntentResponseSchema
>;

/** Unix seconds when sync ends, or null for an already-cancelling subscription. */
export const StripeCancelResponseSchema = loosePlainObject({
  cancelAt: z.number().nullable(),
});

export type StripeCancelResponse = z.infer<typeof StripeCancelResponseSchema>;

/** Hosted Stripe Checkout URL, or null when unavailable or ineligible. */
export const StripeCheckoutSessionResponseSchema = loosePlainObject({
  url: z.string().nullable(),
});

export type StripeCheckoutSessionResponse = z.infer<
  typeof StripeCheckoutSessionResponseSchema
>;

/** Stripe Billing Portal URL, or null when no Stripe subscription is managed. */
export const StripePortalResponseSchema = loosePlainObject({
  portalUrl: z.string().nullable(),
});

export type StripePortalResponse = z.infer<typeof StripePortalResponseSchema>;

export function isStripeCancelResponse(
  value: unknown,
): value is StripeCancelResponse {
  return StripeCancelResponseSchema.safeParse(value).success;
}

export function isStripeCheckoutSessionResponse(
  value: unknown,
): value is StripeCheckoutSessionResponse {
  return StripeCheckoutSessionResponseSchema.safeParse(value).success;
}

export function isStripeCheckoutOptionsResponse(
  value: unknown,
): value is StripeCheckoutOptionsResponse {
  return StripeCheckoutOptionsResponseSchema.safeParse(value).success;
}

export function isStripeCheckoutIntentResponse(
  value: unknown,
): value is StripeCheckoutIntentResponse {
  return StripeCheckoutIntentResponseSchema.safeParse(value).success;
}

export function isStripePortalResponse(
  value: unknown,
): value is StripePortalResponse {
  return StripePortalResponseSchema.safeParse(value).success;
}

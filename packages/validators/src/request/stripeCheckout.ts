import { z } from "zod";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import { loosePlainObject, nonEmptyStringSchema } from "../schema";
import { stripeReturnUrlOriginRefinement } from "../stripeCheckoutRefinements";

/** The Stripe Price of the plan the buyer chose, from the checkout options. */
const chosenPriceIdSchema = nonEmptyStringSchema;

/**
 * Pay in the inline form, for the plan the buyer chose. The server charges
 * only that Price, and only while its capacity covers the roster, so the
 * charge always matches the plan the buyer saw.
 */
export const StripeCheckoutRequestSchema = loosePlainObject({
  priceId: chosenPriceIdSchema,
});

export type StripeCheckoutRequest = z.infer<typeof StripeCheckoutRequestSchema>;

export function isStripeCheckoutRequest(
  value: unknown,
): value is StripeCheckoutRequest {
  return StripeCheckoutRequestSchema.safeParse(value).success;
}

/**
 * Change an active Stripe subscription to another plan. A larger plan is
 * charged its prorated difference now; a smaller one takes effect at renewal.
 */
export const StripePlanChangeRequestSchema = loosePlainObject({
  priceId: chosenPriceIdSchema,
});

export type StripePlanChangeRequest = z.infer<
  typeof StripePlanChangeRequestSchema
>;

export function isStripePlanChangeRequest(
  value: unknown,
): value is StripePlanChangeRequest {
  return StripePlanChangeRequestSchema.safeParse(value).success;
}

/** Caller-selected app URL used after a hosted Stripe flow completes. */
export const StripeReturnUrlRequestSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      returnUrl: z.string(),
    }),
    [stripeReturnUrlOriginRefinement],
  );

export type StripeReturnUrlRequest = z.infer<
  typeof StripeReturnUrlRequestSchema
>;

export function isStripeReturnUrlRequest(
  value: unknown,
): value is StripeReturnUrlRequest {
  return StripeReturnUrlRequestSchema.safeParse(value).success;
}

/** The hosted fallback: the chosen plan and where Stripe returns the buyer. */
export const StripeCheckoutSessionRequestSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      priceId: chosenPriceIdSchema,
      returnUrl: z.string(),
    }),
    [stripeReturnUrlOriginRefinement],
  );

export type StripeCheckoutSessionRequest = z.infer<
  typeof StripeCheckoutSessionRequestSchema
>;

export function isStripeCheckoutSessionRequest(
  value: unknown,
): value is StripeCheckoutSessionRequest {
  return StripeCheckoutSessionRequestSchema.safeParse(value).success;
}

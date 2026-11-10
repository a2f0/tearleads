import { z } from "zod";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import { loosePlainObject, nonEmptyStringSchema } from "../schema";
import { stripeReturnUrlOriginRefinement } from "../stripeCheckoutRefinements";

/**
 * The Stripe Price the buyer was shown when they pressed Pay. The server
 * charges only that Price, so a roster change since the form opened cannot
 * charge an amount the buyer never saw.
 */
export const StripeCheckoutRequestSchema = loosePlainObject({
  priceId: nonEmptyStringSchema,
});

export type StripeCheckoutRequest = z.infer<typeof StripeCheckoutRequestSchema>;

export function isStripeCheckoutRequest(
  value: unknown,
): value is StripeCheckoutRequest {
  return StripeCheckoutRequestSchema.safeParse(value).success;
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

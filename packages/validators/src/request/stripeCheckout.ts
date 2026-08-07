import { z } from "zod";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import { loosePlainObject } from "../schema";
import { stripeReturnUrlOriginRefinement } from "../stripeCheckoutRefinements";

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

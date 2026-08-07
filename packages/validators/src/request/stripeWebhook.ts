import type { z } from "zod";
import { plainObjectSchema } from "../schema";

/** Any valid top-level Stripe event object; event variants are provider-owned. */
export const StripeWebhookRequestSchema = plainObjectSchema;

export type StripeWebhookRequest = z.infer<typeof StripeWebhookRequestSchema>;

export function isStripeWebhookRequest(
  value: unknown,
): value is StripeWebhookRequest {
  return StripeWebhookRequestSchema.safeParse(value).success;
}

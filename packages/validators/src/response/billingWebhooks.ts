import { z } from "zod";
import { loosePlainObject } from "../schema";

export const RevenueCatWebhookResponseSchema = loosePlainObject({
  received: z.literal(true),
  outcome: z.literal(["applied", "duplicate", "ignored"]),
});

export type RevenueCatWebhookResponse = z.infer<
  typeof RevenueCatWebhookResponseSchema
>;

export const StripeWebhookResponseSchema = loosePlainObject({
  received: z.literal(true),
  outcome: z.literal(["associated", "ignored", "reconciled"]),
});

export type StripeWebhookResponse = z.infer<typeof StripeWebhookResponseSchema>;

export function isRevenueCatWebhookResponse(
  value: unknown,
): value is RevenueCatWebhookResponse {
  return RevenueCatWebhookResponseSchema.safeParse(value).success;
}

export function isStripeWebhookResponse(
  value: unknown,
): value is StripeWebhookResponse {
  return StripeWebhookResponseSchema.safeParse(value).success;
}

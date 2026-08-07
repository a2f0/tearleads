import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";
import { arraySchema, loosePlainObject, nonEmptyArraySchema } from "../schema";

const MAX_VALID_DATE_MS = 8_640_000_000_000_000;

const RevenueCatTimestampMsSchema = registerJsonSchemaFragment(
  z.custom<number>(
    (value) =>
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= MAX_VALID_DATE_MS,
  ),
  {
    maximum: MAX_VALID_DATE_MS,
    minimum: 0,
    type: "integer",
  },
);

const RevenueCatLifecycleEventTypeSchema = registerJsonSchemaFragment(
  z.string().refine((value) => value !== "TRANSFER"),
  { not: { const: "TRANSFER" }, type: "string" },
);

/** A single RevenueCat subscriber attribute; cleared values are null. */
export const RevenueCatSubscriberAttributeSchema = loosePlainObject({
  value: z.string().nullable(),
});

export type RevenueCatSubscriberAttribute = z.infer<
  typeof RevenueCatSubscriberAttributeSchema
>;

const RevenueCatSubscriberAttributesSchema = z.record(
  z.string(),
  RevenueCatSubscriberAttributeSchema,
);

const RevenueCatMetadataValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const RevenueCatMetadataSchema = z.record(
  z.string(),
  RevenueCatMetadataValueSchema,
);

/** Lifecycle event fields consumed by organization sync billing. */
export const RevenueCatWebhookEventSchema = loosePlainObject({
  id: z.string(),
  type: RevenueCatLifecycleEventTypeSchema,
  app_user_id: z.string(),
  event_timestamp_ms: RevenueCatTimestampMsSchema,
  purchased_at_ms: RevenueCatTimestampMsSchema.nullable().optional(),
  expiration_at_ms: RevenueCatTimestampMsSchema.nullable().optional(),
  product_id: z.string().nullable().optional(),
  new_product_id: z.string().nullable().optional(),
  transaction_id: z.string().nullable().optional(),
  original_transaction_id: z.string().nullable().optional(),
  entitlement_ids: arraySchema(z.string()).optional(),
  store: z.string().nullable().optional(),
  environment: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  price_in_purchased_currency: z.number().nullable().optional(),
  period_type: z.string().nullable().optional(),
  subscriber_attributes: RevenueCatSubscriberAttributesSchema.optional(),
  metadata: RevenueCatMetadataSchema.nullable().optional(),
});

export type RevenueCatWebhookEvent = z.infer<
  typeof RevenueCatWebhookEventSchema
>;

/** Receipt-transfer event, which carries destination identities instead. */
export const RevenueCatTransferWebhookEventSchema = loosePlainObject({
  id: z.string(),
  type: z.literal("TRANSFER"),
  event_timestamp_ms: RevenueCatTimestampMsSchema,
  transferred_from: arraySchema(z.string()),
  transferred_to: nonEmptyArraySchema(z.string()),
  store: z.string().nullable().optional(),
  environment: z.string().nullable().optional(),
});

export type RevenueCatTransferWebhookEvent = z.infer<
  typeof RevenueCatTransferWebhookEventSchema
>;

export const RevenueCatIncomingWebhookEventSchema = z.union([
  RevenueCatTransferWebhookEventSchema,
  RevenueCatWebhookEventSchema,
]);

export type RevenueCatIncomingWebhookEvent = z.infer<
  typeof RevenueCatIncomingWebhookEventSchema
>;

/** Request envelope RevenueCat posts to the billing webhook. */
export const RevenueCatWebhookRequestSchema = loosePlainObject({
  api_version: z.string().optional(),
  event: RevenueCatIncomingWebhookEventSchema,
});

export type RevenueCatWebhookRequest = z.infer<
  typeof RevenueCatWebhookRequestSchema
>;

export function isRevenueCatTransferWebhookEvent(
  value: unknown,
): value is RevenueCatTransferWebhookEvent {
  return RevenueCatTransferWebhookEventSchema.safeParse(value).success;
}

export function isRevenueCatWebhookRequest(
  value: unknown,
): value is RevenueCatWebhookRequest {
  return RevenueCatWebhookRequestSchema.safeParse(value).success;
}

/**
 * Loose schemas for the Stripe REST responses the Stripe domain calls read
 * (stripeApi.ts and its customer, management, and session siblings). Each
 * schema covers fields one decision needs together; fields that decide
 * separately get separate schemas, so a malformed field never hides a
 * readable sibling.
 */

import { z } from "zod";
import {
  providerStringSchema,
  readProviderField,
  stripeReferenceSchema,
} from "./providerPayloadSchema";

export const stripeObjectIdSchema = z.looseObject({ id: providerStringSchema });

/** Only the first search match is read; later entries may be anything. */
export const customerSearchSchema = z.looseObject({
  data: z.tuple([stripeObjectIdSchema], z.unknown()),
});

export const subscriptionStatusSchema = z.looseObject({
  status: providerStringSchema,
});

const checkoutAttemptSchema = z.looseObject({
  metadata: z.looseObject({ checkoutAttemptId: providerStringSchema }),
});

/** Read on its own: a terminal subscription needs only its attempt id. */
export function readCheckoutAttemptId(value: unknown): string | null {
  return (
    readProviderField(checkoutAttemptSchema, value)?.metadata
      .checkoutAttemptId ?? null
  );
}

/** The buyer, Price, and quantity an incomplete checkout was created with. */
export const pendingCheckoutSchema = z.looseObject({
  metadata: z.looseObject({
    checkoutAttemptId: providerStringSchema,
    userId: providerStringSchema,
  }),
  items: z.looseObject({
    data: z.tuple(
      [
        z.looseObject({
          price: stripeObjectIdSchema,
          quantity: z.literal(1),
        }),
      ],
      z.unknown(),
    ),
  }),
});

export const checkoutIntentSchema = z.looseObject({
  id: providerStringSchema,
  latest_invoice: z.looseObject({
    payment_intent: z.looseObject({ client_secret: providerStringSchema }),
  }),
});

export const subscriptionSearchItemSchema = z.looseObject({
  id: providerStringSchema,
  status: providerStringSchema,
});

export const liveSubscriptionSearchItemSchema = z.looseObject({
  id: providerStringSchema,
  status: providerStringSchema,
  customer: stripeReferenceSchema,
  metadata: z.looseObject({ orgId: providerStringSchema }),
});

export const subscriptionCancelSchema = z.looseObject({
  cancel_at: z.number(),
});

export const hostedUrlSchema = z.looseObject({ url: providerStringSchema });

export const hostedCheckoutSessionSchema = z.looseObject({
  id: providerStringSchema,
  url: providerStringSchema,
});

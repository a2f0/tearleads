import { expect, test } from "bun:test";
import {
  isStripeWebhookRequest,
  StripeWebhookRequestSchema,
} from "./stripeWebhook";

test("Stripe webhook requests accept provider-owned event objects by identity", () => {
  const event = {
    data: { object: { future_invoice_field: true } },
    id: "evt_1",
    type: "invoice.paid",
  };
  const result = StripeWebhookRequestSchema.safeParse(event);

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data as unknown).toBe(event);
  }
  expect(isStripeWebhookRequest(event)).toBe(true);
  expect(isStripeWebhookRequest([])).toBe(false);
  expect(isStripeWebhookRequest(null)).toBe(false);
});

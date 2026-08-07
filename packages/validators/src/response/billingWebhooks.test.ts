import { expect, test } from "bun:test";
import {
  isRevenueCatWebhookResponse,
  isStripeWebhookResponse,
  RevenueCatWebhookResponseSchema,
  StripeWebhookResponseSchema,
} from "./billingWebhooks";

test("billing webhook response schemas preserve extensions and identity", () => {
  const revenueCat = {
    futureResponseField: true,
    outcome: "applied",
    received: true,
  } as const;
  const stripe = {
    futureResponseField: true,
    outcome: "reconciled",
    received: true,
  } as const;

  expect(RevenueCatWebhookResponseSchema.parse(revenueCat)).toBe(revenueCat);
  expect(StripeWebhookResponseSchema.parse(stripe)).toBe(stripe);
  expect(isRevenueCatWebhookResponse(revenueCat)).toBe(true);
  expect(isStripeWebhookResponse(stripe)).toBe(true);
});

test("billing webhook response schemas reject provider-incompatible outcomes", () => {
  expect(
    isRevenueCatWebhookResponse({ received: true, outcome: "associated" }),
  ).toBe(false);
  expect(
    isStripeWebhookResponse({ received: true, outcome: "duplicate" }),
  ).toBe(false);
  expect(isStripeWebhookResponse({ received: false, outcome: "ignored" })).toBe(
    false,
  );
});

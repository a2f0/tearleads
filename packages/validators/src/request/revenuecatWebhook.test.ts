import { expect, test } from "bun:test";
import { isRevenueCatWebhookRequest } from "./revenuecatWebhook";

function webhook(overrides: Record<string, unknown> = {}) {
  return {
    api_version: "1.0",
    event: {
      app_user_id: "user-1",
      event_timestamp_ms: 1_000,
      expiration_at_ms: 2_000,
      id: "event-1",
      type: "INITIAL_PURCHASE",
      ...overrides,
    },
  };
}

test("accepts finite non-negative integer RevenueCat timestamps", () => {
  expect(isRevenueCatWebhookRequest(webhook())).toBe(true);
  expect(isRevenueCatWebhookRequest(webhook({ expiration_at_ms: null }))).toBe(
    true,
  );
});

test("rejects invalid RevenueCat timestamps before they reach Date writes", () => {
  expect(
    isRevenueCatWebhookRequest(webhook({ event_timestamp_ms: Number.NaN })),
  ).toBe(false);
  expect(
    isRevenueCatWebhookRequest(webhook({ event_timestamp_ms: Infinity })),
  ).toBe(false);
  expect(isRevenueCatWebhookRequest(webhook({ event_timestamp_ms: -1 }))).toBe(
    false,
  );
  expect(isRevenueCatWebhookRequest(webhook({ event_timestamp_ms: 1.5 }))).toBe(
    false,
  );
  expect(
    isRevenueCatWebhookRequest(webhook({ expiration_at_ms: Infinity })),
  ).toBe(false);
});

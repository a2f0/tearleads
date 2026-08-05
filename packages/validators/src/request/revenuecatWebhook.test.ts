import { expect, test } from "bun:test";
import { isRevenueCatWebhookRequest } from "./revenuecatWebhook";

function webhook(overrides: Record<string, unknown> = {}) {
  return {
    api_version: "1.0",
    event: {
      app_user_id: "user-1",
      event_timestamp_ms: 1_000,
      purchased_at_ms: 500,
      expiration_at_ms: 2_000,
      id: "event-1",
      original_transaction_id: "original-transaction-1",
      product_id: "sync_monthly",
      transaction_id: "transaction-1",
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
  expect(isRevenueCatWebhookRequest(webhook({ purchased_at_ms: null }))).toBe(
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
  expect(
    isRevenueCatWebhookRequest(webhook({ purchased_at_ms: Infinity })),
  ).toBe(false);
  expect(isRevenueCatWebhookRequest(webhook({ product_id: 123 }))).toBe(false);
});

test("accepts the transaction metadata shapes RevenueCat documents", () => {
  expect(isRevenueCatWebhookRequest(webhook({ metadata: null }))).toBe(true);
  expect(isRevenueCatWebhookRequest(webhook({ metadata: {} }))).toBe(true);
  expect(
    isRevenueCatWebhookRequest(
      webhook({
        metadata: { orgId: "org-1", seats: 3, trial: false, note: null },
      }),
    ),
  ).toBe(true);
});

test("rejects metadata that is not a flat primitive map", () => {
  expect(isRevenueCatWebhookRequest(webhook({ metadata: "orgId" }))).toBe(
    false,
  );
  expect(
    isRevenueCatWebhookRequest(webhook({ metadata: { orgId: { deep: 1 } } })),
  ).toBe(false);
  expect(
    isRevenueCatWebhookRequest(webhook({ metadata: { orgId: ["org-1"] } })),
  ).toBe(false);
});

test("accepts the store field as string, null, or absent", () => {
  expect(isRevenueCatWebhookRequest(webhook({ store: "STRIPE" }))).toBe(true);
  expect(isRevenueCatWebhookRequest(webhook({ store: null }))).toBe(true);
  expect(isRevenueCatWebhookRequest(webhook({ store: 42 }))).toBe(false);
});

test("accepts a nullable new product id for product changes", () => {
  expect(
    isRevenueCatWebhookRequest(
      webhook({
        new_product_id: "sync_team_5_monthly",
        type: "PRODUCT_CHANGE",
      }),
    ),
  ).toBe(true);
  expect(isRevenueCatWebhookRequest(webhook({ new_product_id: null }))).toBe(
    true,
  );
  expect(isRevenueCatWebhookRequest(webhook({ new_product_id: 5 }))).toBe(
    false,
  );
});

test("accepts the environment field as string, null, or absent", () => {
  expect(isRevenueCatWebhookRequest(webhook({ environment: "SANDBOX" }))).toBe(
    true,
  );
  expect(
    isRevenueCatWebhookRequest(webhook({ environment: "PRODUCTION" })),
  ).toBe(true);
  expect(isRevenueCatWebhookRequest(webhook({ environment: null }))).toBe(true);
  expect(isRevenueCatWebhookRequest(webhook({ environment: 1 }))).toBe(false);
});

test("accepts nullable RevenueCat purchased-currency financial fields", () => {
  expect(
    isRevenueCatWebhookRequest(
      webhook({
        currency: "USD",
        period_type: "NORMAL",
        price_in_purchased_currency: 19.99,
      }),
    ),
  ).toBe(true);
  expect(
    isRevenueCatWebhookRequest(
      webhook({ currency: null, price_in_purchased_currency: null }),
    ),
  ).toBe(true);
  expect(
    isRevenueCatWebhookRequest(
      webhook({ price_in_purchased_currency: Number.NaN }),
    ),
  ).toBe(false);
  expect(isRevenueCatWebhookRequest(webhook({ period_type: 1 }))).toBe(false);
});

test("accepts RevenueCat transfer events without an app user id", () => {
  const transfer = {
    api_version: "1.0",
    event: {
      environment: "SANDBOX",
      event_timestamp_ms: 1_000,
      id: "transfer-1",
      store: "PLAY_STORE",
      transferred_from: ["old-user"],
      transferred_to: ["new-user"],
      type: "TRANSFER",
    },
  };
  expect(isRevenueCatWebhookRequest(transfer)).toBe(true);
  expect(
    isRevenueCatWebhookRequest({
      event: { ...transfer.event, transferred_from: [] },
    }),
  ).toBe(true);
  expect(
    isRevenueCatWebhookRequest({
      ...transfer,
      event: { ...transfer.event, transferred_to: [] },
    }),
  ).toBe(false);
  expect(
    isRevenueCatWebhookRequest({
      ...transfer,
      event: { ...transfer.event, transferred_from: "old-user" },
    }),
  ).toBe(false);
  expect(
    isRevenueCatWebhookRequest(
      webhook({ transferred_to: 5, type: "TRANSFER" }),
    ),
  ).toBe(false);
});

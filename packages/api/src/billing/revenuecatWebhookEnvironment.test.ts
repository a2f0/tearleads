import { expect, test } from "bun:test";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { classifyRevenueCatEvent } from "./revenuecatWebhook";

const ACTIVE_GRANT_NOW = new Date(1_500);

function makeEvent(
  overrides: Partial<RevenueCatWebhookEvent> = {},
): RevenueCatWebhookEvent {
  return {
    app_user_id: "user-1",
    entitlement_ids: ["sync"],
    event_timestamp_ms: 1_000,
    expiration_at_ms: 2_000,
    id: "event-1",
    original_transaction_id: "original-transaction-1",
    product_id: "sync_monthly",
    purchased_at_ms: 500,
    subscriber_attributes: {
      orgId: { value: "11111111-1111-4111-8111-111111111111" },
    },
    transaction_id: "transaction-1",
    type: "INITIAL_PURCHASE",
    ...overrides,
  };
}

test("a sandbox purchase is ignored on a production-only tier", () => {
  // StoreKit sandbox / TestFlight / Play internal testing emit an event that is
  // identical to a paid one apart from `environment`, so without this a tester
  // provisions real sync and real seats for free.
  const transition = classifyRevenueCatEvent(
    makeEvent({ environment: "SANDBOX" }),
    ACTIVE_GRANT_NOW,
  );
  expect(transition).toEqual({
    kind: "ignore",
    reason: "Sandbox environment event ignored on a production-only tier",
  });
});

test("a sandbox revoke is ignored too, not applied one-sidedly", () => {
  // Applying only the revoke half of a sandbox lifecycle would disable sync an
  // organization actually paid for.
  const transition = classifyRevenueCatEvent(
    makeEvent({ environment: "SANDBOX", type: "EXPIRATION" }),
    ACTIVE_GRANT_NOW,
  );
  expect(transition.kind).toBe("ignore");
});

test("a sandbox purchase grants on a tier that opts in", () => {
  const transition = classifyRevenueCatEvent(
    makeEvent({ environment: "SANDBOX" }),
    ACTIVE_GRANT_NOW,
    { allowSandboxEvents: true },
  );
  expect(transition.kind).toBe("grant");
});

test("the sandbox environment is matched case-insensitively", () => {
  expect(
    classifyRevenueCatEvent(
      makeEvent({ environment: "sandbox" }),
      ACTIVE_GRANT_NOW,
    ).kind,
  ).toBe("ignore");
});

test("a production event grants without opting into sandbox", () => {
  expect(
    classifyRevenueCatEvent(
      makeEvent({ environment: "PRODUCTION" }),
      ACTIVE_GRANT_NOW,
    ).kind,
  ).toBe("grant");
});

test("an event with no environment is treated as production", () => {
  // RevenueCat has not always sent the field; a redelivered old event must keep
  // its original paid meaning rather than being discarded.
  expect(classifyRevenueCatEvent(makeEvent(), ACTIVE_GRANT_NOW).kind).toBe(
    "grant",
  );
});

test("a resolved Stripe test-mode event is exempt from the sandbox gate", () => {
  // RevenueCat marks Stripe test-mode transactions SANDBOX too. Gating them
  // would stop a tier that exercises direct Stripe checkout with test-mode keys
  // from applying its own web billing — the documented way to test fixed-tier
  // enrollment. Stripe attribution is protected instead by the exact
  // subscription binding, which cannot resolve across Stripe modes.
  const transition = classifyRevenueCatEvent(
    makeEvent({ environment: "SANDBOX", store: "STRIPE" }),
    ACTIVE_GRANT_NOW,
    { stripeSeatCount: 1 },
  );
  expect(transition.kind).toBe("grant");
});

test("a non-Stripe sandbox event is still gated when Stripe is exempt", () => {
  // The exemption is scoped to the store, not to the environment value, so the
  // native lane keeps its guard.
  expect(
    classifyRevenueCatEvent(
      makeEvent({ environment: "SANDBOX", store: "APP_STORE" }),
      ACTIVE_GRANT_NOW,
    ).kind,
  ).toBe("ignore");
  // A store-less sandbox event fails closed rather than being treated as Stripe.
  expect(
    classifyRevenueCatEvent(
      makeEvent({ environment: "SANDBOX" }),
      ACTIVE_GRANT_NOW,
    ).kind,
  ).toBe("ignore");
});

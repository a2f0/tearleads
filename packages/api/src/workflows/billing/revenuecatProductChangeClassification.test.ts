import { expect, spyOn, test } from "bun:test";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import {
  classifyRevenueCatEvent,
  NON_NATIVE_REVENUECAT_PRODUCT_CHANGE_REASON,
  UNKNOWN_REVENUECAT_PRODUCT_CHANGE_STORE_REASON,
} from "../../billing/revenuecatWebhook";
import {
  PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON,
  resolveBoundRevenueCatTransition,
} from "./revenuecatGrantCapacity";
import type { LockedBillingIdentity } from "./revenuecatStripeResolution";
import { logUnappliedRevenueCatPaidEvent } from "./revenuecatWebhookLogging";

const PRODUCT_CHANGE: RevenueCatWebhookEvent = {
  app_user_id: "buyer",
  event_timestamp_ms: 1,
  id: "product-change",
  new_product_id: "sync_team_5_monthly",
  original_transaction_id: "native-subscription",
  product_id: "sync_solo_monthly",
  store: "PLAY_STORE",
  type: "PRODUCT_CHANGE",
};
const BOUND_SOLO_BILLING: LockedBillingIdentity = {
  checkoutAttemptExpiresAt: null,
  checkoutAttemptId: null,
  provider: "revenuecat",
  providerCustomerId: "buyer",
  providerProductId: "sync_solo_monthly",
  providerSubscriptionId: "native-subscription",
  providerTransactionId: "native-transaction",
  seatCount: 1,
  status: "active",
};

function resolveProductChange(input: {
  billing?: LockedBillingIdentity | undefined;
  event?: RevenueCatWebhookEvent;
}) {
  const event = input.event ?? PRODUCT_CHANGE;
  return resolveBoundRevenueCatTransition({
    allowSandboxEvents: true,
    billing: "billing" in input ? input.billing : BOUND_SOLO_BILLING,
    event,
    now: new Date(1),
    transition: classifyRevenueCatEvent(event, new Date(1), {
      allowSandboxEvents: true,
    }),
  });
}

test("a product change rejects a different RevenueCat buyer", () => {
  expect(
    resolveProductChange({
      event: { ...PRODUCT_CHANGE, app_user_id: "different-buyer" },
    }),
  ).toEqual({
    kind: "ignore",
    reason: PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON,
  });
});

test("a product change rejects a mismatched bound seat capacity", () => {
  expect(
    resolveProductChange({ billing: { ...BOUND_SOLO_BILLING, seatCount: 5 } }),
  ).toEqual({
    kind: "ignore",
    reason: PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON,
  });
});

test("a product change rejects a missing billing binding", () => {
  expect(resolveProductChange({ billing: undefined })).toEqual({
    kind: "ignore",
    reason: PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON,
  });
});

test("a product change rejects a non-native store", () => {
  expect(
    resolveProductChange({ event: { ...PRODUCT_CHANGE, store: "STRIPE" } }),
  ).toEqual({
    kind: "ignore",
    reason: NON_NATIVE_REVENUECAT_PRODUCT_CHANGE_REASON,
  });
});

test("a product change rejects an unknown store explicitly", () => {
  expect(
    resolveProductChange({ event: { ...PRODUCT_CHANGE, store: "UNKNOWN" } }),
  ).toEqual({
    kind: "ignore",
    reason: UNKNOWN_REVENUECAT_PRODUCT_CHANGE_STORE_REASON,
  });
});

test("a product change rejects an unbound Play purchase token", () => {
  expect(
    resolveProductChange({
      event: {
        ...PRODUCT_CHANGE,
        original_transaction_id: "replacement-purchase-token",
      },
    }),
  ).toEqual({
    kind: "ignore",
    reason: PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON,
  });
});

test("a product change accepts a chained configured source tier", () => {
  expect(
    resolveProductChange({
      event: {
        ...PRODUCT_CHANGE,
        product_id: "sync_team_10_monthly",
      },
    }),
  ).toEqual({ kind: "schedule", fields: { status: "active" } });
});

test("a rejected product change alerts the operator", () => {
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    logUnappliedRevenueCatPaidEvent(PRODUCT_CHANGE, {
      status: "ignored",
      reason: PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      `RevenueCat paid product change ${PRODUCT_CHANGE.id} was not applied: ${PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON}`,
    );
  } finally {
    errorSpy.mockRestore();
  }
});

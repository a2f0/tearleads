import { expect, test } from "bun:test";
import {
  BILLING_PURCHASE_TRACE_PATTERN,
  formatBillingPurchaseFailure,
  formatBillingPurchaseStage,
  formatBillingPurchaseSuccess,
} from "./billingPurchaseTrace";

test("formats purchase lifecycle stages as clipboard-safe telemetry", () => {
  const lines = [
    formatBillingPurchaseStage("started"),
    formatBillingPurchaseStage("identified"),
    formatBillingPurchaseStage("provider-started"),
    formatBillingPurchaseStage("cancelled"),
    formatBillingPurchaseSuccess(true),
    formatBillingPurchaseSuccess(false),
  ];

  for (const line of lines) {
    expect(BILLING_PURCHASE_TRACE_PATTERN.test(line)).toBe(true);
  }
});

test("maps RevenueCat and Apple native error codes without free text", () => {
  const line = formatBillingPurchaseFailure({
    code: "2",
    underlyingErrorMessage:
      "Error Domain=ASDErrorDomain Code=509 PRIVATE buyer@example.com",
    userCancelled: false,
  });

  expect(line).toBe(
    "billing purchase stage=failed code=store-problem native=asd:509 userCancelled=false",
  );
  expect(BILLING_PURCHASE_TRACE_PATTERN.test(line)).toBe(true);
  expect(line).not.toContain("PRIVATE");
  expect(line).not.toContain("buyer@example.com");
});

test("unknown provider content fails closed", () => {
  const line = formatBillingPurchaseFailure({
    code: "PRIVATE-code",
    underlyingErrorMessage:
      "PrivateDomain Code=123 customer cardiology document",
    userCancelled: "PRIVATE",
  });

  expect(line).toBe(
    "billing purchase stage=failed code=other native=none userCancelled=unknown",
  );
  expect(BILLING_PURCHASE_TRACE_PATTERN.test(line)).toBe(true);
  expect(line).not.toContain("PRIVATE");
  expect(line).not.toContain("cardiology");
});

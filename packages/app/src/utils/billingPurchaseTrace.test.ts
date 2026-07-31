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
    formatBillingPurchaseStage("aborted"),
    formatBillingPurchaseStage("identified"),
    formatBillingPurchaseStage("provider-started"),
    formatBillingPurchaseStage("cancelled"),
    formatBillingPurchaseStage("superseded"),
    formatBillingPurchaseSuccess(true),
    formatBillingPurchaseSuccess(false),
    formatBillingPurchaseSuccess(true, true),
    formatBillingPurchaseFailure({ code: "5" }, true),
  ];

  for (const line of lines) {
    expect(BILLING_PURCHASE_TRACE_PATTERN.test(line)).toBe(true);
  }
});

test("extracts native codes from the iOS Capacitor error shape", () => {
  const line = formatBillingPurchaseFailure({
    code: "5",
    message:
      "Product unavailable. Error Domain=ASDErrorDomain Code=509 PRIVATE buyer@example.com",
  });

  expect(line).toBe(
    "billing purchase stage=failed code=product-unavailable backend=none native=asd:509 userCancelled=unknown",
  );
  expect(BILLING_PURCHASE_TRACE_PATTERN.test(line)).toBe(true);
  expect(line).not.toContain("PRIVATE");
  expect(line).not.toContain("buyer@example.com");
});

test("maps RevenueCat and Apple native error codes without free text", () => {
  const line = formatBillingPurchaseFailure({
    code: "2",
    underlyingErrorMessage:
      "Error Domain=ASDErrorDomain Code=509 PRIVATE buyer@example.com",
    userCancelled: false,
  });

  expect(line).toBe(
    "billing purchase stage=failed code=store-problem backend=none native=asd:509 userCancelled=false",
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
    "billing purchase stage=failed code=other backend=none native=none userCancelled=unknown",
  );
  expect(BILLING_PURCHASE_TRACE_PATTERN.test(line)).toBe(true);
  expect(line).not.toContain("PRIVATE");
  expect(line).not.toContain("cardiology");
});

test("extracts safe diagnostics preserved by the native bridge", () => {
  const line = formatBillingPurchaseFailure({
    code: "8",
    data: {
      backendErrorCode: 7712,
      storeError: { code: 7, domain: "StoreKitErrorDomain" },
      userCancelled: false,
    },
  });

  expect(line).toBe(
    "billing purchase stage=failed code=invalid-receipt backend=7712 native=storekit:7 userCancelled=false",
  );
  expect(BILLING_PURCHASE_TRACE_PATTERN.test(line)).toBe(true);
});

test("new native diagnostic fields reject private or unbounded values", () => {
  for (const backendErrorCode of ["not-a-number", "12345678901"]) {
    const line = formatBillingPurchaseFailure({
      code: "2",
      data: {
        backendErrorCode,
        storeError: { code: 1, domain: "PRIVATE cardiology" },
      },
    });

    expect(line).toBe(
      "billing purchase stage=failed code=store-problem backend=none native=none userCancelled=unknown",
    );
    expect(BILLING_PURCHASE_TRACE_PATTERN.test(line)).toBe(true);
    expect(line).not.toContain("PRIVATE");
    expect(line).not.toContain("cardiology");
  }
});

test("native error classification requires a bounded Code field", () => {
  const nearbyNumber = formatBillingPurchaseFailure({
    code: "2",
    underlyingErrorMessage: "ASDErrorDomain transaction 509",
  });
  const oversizedCode = formatBillingPurchaseFailure({
    code: "2",
    underlyingErrorMessage: "ASDErrorDomain Code=12345678901",
  });

  expect(nearbyNumber).toContain("native=none");
  expect(oversizedCode).toContain("native=none");
});

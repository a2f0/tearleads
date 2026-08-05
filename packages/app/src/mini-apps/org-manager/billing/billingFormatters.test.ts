import { afterEach, expect, test } from "bun:test";
import type { OrganizationBillingHistoryEntry } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { BillingHistory } from "./BillingHistory";
import {
  formatBillingAmount,
  formatPrice,
  formatTotalAmount,
} from "./billingFormatters";

afterEach(() => cleanup());

function entry(
  overrides: Partial<OrganizationBillingHistoryEntry>,
): OrganizationBillingHistoryEntry {
  return {
    activeSeatCount: null,
    billingReason: null,
    category: "lifecycle",
    currency: null,
    environment: null,
    eventType: "INITIAL_PURCHASE",
    id: "history-entry",
    interval: null,
    intervalCount: null,
    invoiceId: null,
    occurredAt: "2026-07-01T12:00:00.000Z",
    outcome: "applied",
    periodEndsAt: null,
    periodStartsAt: null,
    priceId: null,
    productId: null,
    provider: "revenuecat",
    seatCount: null,
    seatDelta: null,
    subscriptionId: null,
    totalAmount: null,
    totalCurrency: null,
    transactionId: null,
    unitAmount: null,
    ...overrides,
  };
}

test("a production native charge shows RevenueCat's purchased-currency total", () => {
  const view = render(
    createElement(BillingHistory, {
      entries: [
        entry({
          currency: "usd",
          environment: "production",
          eventType: "RENEWAL",
          id: "production-renewal",
          interval: "month",
          intervalCount: 1,
          seatCount: 10,
          totalAmount: 1_999,
          totalCurrency: "EUR",
          unitAmount: 2_000,
        }),
      ],
      error: null,
      loading: false,
    }),
  );

  expect(view.getByText("Paid: €19.99")).toBeDefined();
  expect(view.getByText("USD list price: $20.00/month")).toBeDefined();
});

test("a sandbox native charge is identified without implying real payment", () => {
  const view = render(
    createElement(BillingHistory, {
      entries: [
        entry({
          environment: "sandbox",
          eventType: "INITIAL_PURCHASE",
          id: "sandbox-purchase",
        }),
      ],
      error: null,
      loading: false,
    }),
  );

  expect(view.getByText("Sandbox transaction — no real charge")).toBeDefined();
  expect(view.queryByText("Paid total unavailable")).toBeNull();
});

test("uses Stripe's two-decimal default for USD", () => {
  expect(formatBillingAmount(499, "usd")).toMatch(/4[.,]99/);
});

test("uses Stripe's documented zero-decimal currency behavior", () => {
  expect(formatBillingAmount(500, "jpy")).toContain("500");
  expect(formatBillingAmount(500, "jpy")).not.toMatch(/5[.,]00/);
});

test("uses Stripe's two-decimal API special cases for ISK and UGX", () => {
  expect(formatBillingAmount(499, "isk")).toMatch(/4[.,]99/);
  expect(formatBillingAmount(499, "ugx")).toMatch(/4[.,]99/);
});

test("uses Stripe's two-decimal API exponent for ISO three-decimal currencies", () => {
  for (const currency of ["bhd", "jod", "kwd", "omr", "tnd"]) {
    const formatted = formatBillingAmount(4_990, currency);
    expect(formatted).toMatch(/49[.,]90/);
    expect(formatted).not.toMatch(/4[.,]990/);
  }
});

test("preserves unknown currencies as unconverted minor units", () => {
  expect(formatBillingAmount(842, "xqz")).toBe("842 XQZ minor units");
  expect(formatBillingAmount(842, "notacurrency")).toBe(
    "842 NOTACURRENCY minor units",
  );
  expect(formatTotalAmount(842, "xqz", "stripe")).toBe("842 XQZ minor units");
});

test("preserves totals whose currency is unavailable", () => {
  expect(formatTotalAmount(842, null, "stripe")).toBe(
    "842 minor units (currency unavailable)",
  );
  expect(formatTotalAmount(842, "  ", "stripe")).toBe(
    "842 minor units (currency unavailable)",
  );
});

test("formats known currencies when supportedValuesOf is unavailable", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, "supportedValuesOf");
  Object.defineProperty(Intl, "supportedValuesOf", {
    configurable: true,
    value: undefined,
  });
  try {
    expect(formatBillingAmount(499, "eur")).toMatch(/4[.,]99/);
    expect(formatPrice(499, "eur", "month", 1)).toMatch(/4[.,]99\/month/);
    expect(formatBillingAmount(499, "xqy")).toBe("499 XQY minor units");
  } finally {
    if (descriptor) {
      Object.defineProperty(Intl, "supportedValuesOf", descriptor);
    } else {
      Reflect.deleteProperty(Intl, "supportedValuesOf");
    }
  }
});

test("rejects negative, fractional, and unsafe minor-unit amounts", () => {
  for (const amount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(formatBillingAmount(amount, "usd")).toBe("");
    expect(formatTotalAmount(amount, "usd", "stripe")).toBe("");
    expect(formatPrice(amount, "usd", "month", 1)).toBe("");
  }
});

test("formats exact and zero provider totals without deriving a charge", () => {
  expect(formatTotalAmount(842, "usd", "stripe")).toMatch(/8[.,]42/);
  expect(formatTotalAmount(0, "usd", "stripe")).toMatch(/0[.,]00/);
});

test("formats RevenueCat totals with the purchased currency's ISO exponent", () => {
  expect(formatTotalAmount(500, "jpy", "revenuecat")).toContain("500");
  expect(formatTotalAmount(4_999, "kwd", "revenuecat")).toMatch(/4[.,]999/);
});

test("formats checkout prices with a truthful raw fallback", () => {
  expect(formatPrice(499, "usd", "month", 1)).toMatch(/4[.,]99\/month/);
  expect(formatPrice(499, "usd", null, null)).toMatch(/4[.,]99/);
  expect(formatPrice(null, "usd", "month", 1)).toBe("");
  expect(formatPrice(499, null, "month", 1)).toBe("");
  expect(formatPrice(499, " ", "month", 1)).toBe("");
  expect(formatPrice(499, "xqz", "month", 1)).toBe("499 XQZ minor units/month");
});

test("formats multi-period prices without claiming a one-month cadence", () => {
  expect(formatPrice(499, "usd", "month", 3)).toMatch(
    /4[.,]99\/every 3 months/,
  );
  expect(formatPrice(499, "usd", "month", null)).toMatch(
    /billing cadence unavailable/,
  );
  expect(formatPrice(499, "usd", "month", 0)).toMatch(
    /billing cadence unavailable/,
  );
});

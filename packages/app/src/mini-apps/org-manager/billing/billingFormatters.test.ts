import { expect, test } from "bun:test";
import {
  formatBillingAmount,
  formatPrice,
  formatTotalAmount,
} from "./billingFormatters";

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
  expect(formatTotalAmount(842, "xqz")).toBe("842 XQZ minor units");
});

test("preserves totals whose currency is unavailable", () => {
  expect(formatTotalAmount(842, null)).toBe(
    "842 minor units (currency unavailable)",
  );
  expect(formatTotalAmount(842, "  ")).toBe(
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
    expect(formatTotalAmount(amount, "usd")).toBe("");
    expect(formatPrice(amount, "usd", "month", 1)).toBe("");
  }
});

test("formats exact and zero provider totals without deriving a charge", () => {
  expect(formatTotalAmount(842, "usd")).toMatch(/8[.,]42/);
  expect(formatTotalAmount(0, "usd")).toMatch(/0[.,]00/);
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

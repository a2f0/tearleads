import { expect, test } from "bun:test";
import { formatPrice } from "./BillingDirectCheckout";

/**
 * The minor-unit conversion is the one piece of real logic in the component:
 * the provider reports amounts in minor units, and the exponent is per
 * currency — assuming 100 silently shows JPY at 1/100 of its true price.
 */

test("formats a two-decimal currency from its minor unit", () => {
  const formatted = formatPrice(99, "usd", "month");
  expect(formatted).toContain("0.99");
  expect(formatted).toContain("/month");
});

test("formats a ZERO-decimal currency without dividing by 100", () => {
  // ¥500 is reported as 500 minor units, not 50000.
  const formatted = formatPrice(500, "jpy", "month");
  expect(formatted).toContain("500");
  expect(formatted).not.toContain("5.00");
});

test("omits the interval for a non-recurring price and handles no amount", () => {
  expect(formatPrice(99, "usd", null)).not.toContain("/");
  expect(formatPrice(null, "usd", "month")).toBe("");
});

test("an unknown currency code degrades instead of throwing", () => {
  expect(formatPrice(99, "notacurrency", "month")).toBe("99 NOTACURRENCY");
});

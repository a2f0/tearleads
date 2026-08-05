import { expect, test } from "bun:test";
import { resolveRevenueCatFinancialAuditFields } from "./revenuecatFinancials";

test("normalizes RevenueCat purchased-currency financial facts", () => {
  expect(
    resolveRevenueCatFinancialAuditFields({
      currency: " usd ",
      environment: "production",
      period_type: "normal",
      price_in_purchased_currency: 19.99,
    }),
  ).toEqual({
    currency: "USD",
    environment: "PRODUCTION",
    periodType: "NORMAL",
    priceInPurchasedCurrencyMinor: 1_999,
  });
});

test("uses the purchased currency's ISO exponent", () => {
  expect(
    resolveRevenueCatFinancialAuditFields({
      currency: "JPY",
      environment: "PRODUCTION",
      period_type: "NORMAL",
      price_in_purchased_currency: 500,
    }).priceInPurchasedCurrencyMinor,
  ).toBe(500);
  expect(
    resolveRevenueCatFinancialAuditFields({
      currency: "KWD",
      environment: "PRODUCTION",
      period_type: "NORMAL",
      price_in_purchased_currency: 4.999,
    }).priceInPurchasedCurrencyMinor,
  ).toBe(4_999);
});

test("retains audit labels but omits unusable monetary values", () => {
  expect(
    resolveRevenueCatFinancialAuditFields({
      currency: "XQZ",
      environment: "sandbox",
      period_type: "trial",
      price_in_purchased_currency: 5,
    }),
  ).toEqual({
    currency: "XQZ",
    environment: "SANDBOX",
    periodType: "TRIAL",
    priceInPurchasedCurrencyMinor: null,
  });
  expect(
    resolveRevenueCatFinancialAuditFields({
      currency: null,
      environment: null,
      period_type: null,
      price_in_purchased_currency: null,
    }),
  ).toEqual({
    currency: null,
    environment: null,
    periodType: null,
    priceInPurchasedCurrencyMinor: null,
  });
});

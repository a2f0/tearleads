import { expect, test } from "bun:test";
import { resolveStripeCustomerPortalUrl } from "./config";

test("local builds may omit the Stripe Customer Portal URL", () => {
  expect(resolveStripeCustomerPortalUrl(undefined, false)).toBeNull();
});

test("deployment builds require the Stripe Customer Portal URL", () => {
  expect(() => resolveStripeCustomerPortalUrl("  ", true)).toThrow(
    "PUBLIC_STRIPE_CUSTOMER_PORTAL_URL is required for website deployments",
  );
});

test("deployment builds accept only Stripe-hosted HTTPS portal URLs", () => {
  expect(
    resolveStripeCustomerPortalUrl(
      " https://billing.stripe.com/p/login/test ",
      true,
    ),
  ).toBe("https://billing.stripe.com/p/login/test");
  for (const value of [
    "http://billing.stripe.com/p/login/test",
    "https://billing.stripe.com:444/p/login/test",
    "https://example.com/p/login/test",
  ]) {
    expect(() => resolveStripeCustomerPortalUrl(value, true)).toThrow(
      "PUBLIC_STRIPE_CUSTOMER_PORTAL_URL must be a Stripe-hosted HTTPS URL",
    );
  }
});

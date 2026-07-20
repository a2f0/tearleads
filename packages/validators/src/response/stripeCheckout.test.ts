import { expect, test } from "bun:test";
import {
  isStripeCheckoutIntentResponse,
  isStripeCheckoutOptionsResponse,
  isStripePortalResponse,
} from "./stripeCheckout";

const OPTION = {
  priceId: "price_1",
  productName: "Sync",
  currency: "usd",
  unitAmount: 99,
  interval: "month",
};

test("accepts a well-formed options response, including an empty list", () => {
  expect(isStripeCheckoutOptionsResponse({ options: [OPTION] })).toBe(true);
  // Empty is the legitimate "integration not configured" answer.
  expect(isStripeCheckoutOptionsResponse({ options: [] })).toBe(true);
  // Unpriced / non-recurring prices are representable.
  expect(
    isStripeCheckoutOptionsResponse({
      options: [{ ...OPTION, unitAmount: null, interval: null }],
    }),
  ).toBe(true);
});

test("rejects malformed options", () => {
  expect(isStripeCheckoutOptionsResponse({})).toBe(false);
  expect(isStripeCheckoutOptionsResponse({ options: {} })).toBe(false);
  expect(isStripeCheckoutOptionsResponse(null)).toBe(false);
  // A bad entry must fail the whole list rather than be silently kept.
  expect(
    isStripeCheckoutOptionsResponse({ options: [OPTION, { priceId: "p" }] }),
  ).toBe(false);
  // An empty currency code formats as an empty price label.
  expect(
    isStripeCheckoutOptionsResponse({ options: [{ ...OPTION, currency: "" }] }),
  ).toBe(false);
  // An amount as a string would format as garbage in the UI.
  expect(
    isStripeCheckoutOptionsResponse({
      options: [{ ...OPTION, unitAmount: "99" }],
    }),
  ).toBe(false);
});

test("accepts and rejects checkout intents", () => {
  expect(
    isStripeCheckoutIntentResponse({
      subscriptionId: "sub_1",
      clientSecret: "pi_1_secret_x",
    }),
  ).toBe(true);
  expect(isStripeCheckoutIntentResponse({ subscriptionId: "sub_1" })).toBe(
    false,
  );
  // An empty secret cannot confirm a payment; treat it as malformed.
  expect(
    isStripeCheckoutIntentResponse({
      subscriptionId: "sub_1",
      clientSecret: "",
    }),
  ).toBe(false);
  expect(isStripeCheckoutIntentResponse(null)).toBe(false);
});

test("accepts and rejects portal responses", () => {
  expect(
    isStripePortalResponse({ portalUrl: "https://billing.stripe.com/x" }),
  ).toBe(true);
  // Null is meaningful: no Stripe-store subscription to manage.
  expect(isStripePortalResponse({ portalUrl: null })).toBe(true);
  expect(isStripePortalResponse({})).toBe(false);
  expect(isStripePortalResponse({ portalUrl: 42 })).toBe(false);
});

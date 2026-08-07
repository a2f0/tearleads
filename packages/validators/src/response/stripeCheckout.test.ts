import { expect, test } from "bun:test";
import {
  isStripeCancelResponse,
  isStripeCheckoutIntentResponse,
  isStripeCheckoutOptionsResponse,
  isStripeCheckoutSessionResponse,
  isStripePortalResponse,
  StripeCheckoutOptionsResponseSchema,
} from "./stripeCheckout";

const OPTION = {
  tierId: "team_5",
  seatLimit: 5,
  priceId: "price_1",
  productName: "Sync",
  currency: "usd",
  unitAmount: 99,
  interval: "month",
  intervalCount: 3,
};

test("accepts a well-formed options response, including an empty list", () => {
  expect(isStripeCheckoutOptionsResponse({ options: [OPTION] })).toBe(true);
  // Empty is the legitimate "integration not configured" answer.
  expect(isStripeCheckoutOptionsResponse({ options: [] })).toBe(true);
  // Unpriced / non-recurring prices are representable.
  expect(
    isStripeCheckoutOptionsResponse({
      options: [
        { ...OPTION, unitAmount: null, interval: null, intervalCount: null },
      ],
    }),
  ).toBe(true);
});

test("Stripe response schemas preserve extensions and input identity", () => {
  const input = {
    options: [{ ...OPTION, futureOptionField: true }],
    futureResponseField: true,
  };
  const result = StripeCheckoutOptionsResponseSchema.safeParse(input);

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data as unknown).toBe(input);
  }
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
  expect(
    isStripeCheckoutOptionsResponse({
      options: [{ ...OPTION, intervalCount: 0 }],
    }),
  ).toBe(false);
  expect(
    isStripeCheckoutOptionsResponse({
      options: [{ ...OPTION, intervalCount: 1.5 }],
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

test("accepts and rejects cancellation responses", () => {
  expect(isStripeCancelResponse({ cancelAt: 1893456000 })).toBe(true);
  // Null is meaningful: an already-cancelling subscription reports no date,
  // and the cancellation still took effect.
  expect(isStripeCancelResponse({ cancelAt: null })).toBe(true);
  expect(isStripeCancelResponse({})).toBe(false);
  expect(isStripeCancelResponse({ cancelAt: "soon" })).toBe(false);
  expect(isStripeCancelResponse(null)).toBe(false);
});

test("accepts and rejects checkout-session responses", () => {
  expect(
    isStripeCheckoutSessionResponse({
      url: "https://checkout.stripe.com/x",
    }),
  ).toBe(true);
  // Null is meaningful: unconfigured, or the org is not eligible.
  expect(isStripeCheckoutSessionResponse({ url: null })).toBe(true);
  expect(isStripeCheckoutSessionResponse({})).toBe(false);
  expect(isStripeCheckoutSessionResponse({ url: 5 })).toBe(false);
  expect(isStripeCheckoutSessionResponse(null)).toBe(false);
});

test("accepts and rejects portal responses", () => {
  expect(
    isStripePortalResponse({ portalUrl: "https://billing.stripe.com/x" }),
  ).toBe(true);
  expect(isStripePortalResponse({ portalUrl: null })).toBe(true);
  expect(isStripePortalResponse({})).toBe(false);
  expect(isStripePortalResponse({ portalUrl: 5 })).toBe(false);
});

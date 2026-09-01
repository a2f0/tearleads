import { expect, test } from "bun:test";
import {
  cancelStripeSubscriptionOperation,
  createStripeCheckoutOperation,
  createStripeCheckoutSessionOperation,
  createStripePortalOperation,
  getStripeCheckoutOptionsOperation,
} from "@tearleads/validators/operation";
import {
  stripeCheckoutCreate,
  stripeCheckoutOptionsGet,
  stripeCheckoutSessionCreate,
  stripePortalCreate,
  stripeSubscriptionCancel,
} from "./stripeCheckout";

const organizationId = "11111111-1111-4111-8111-111111111111";

test("Stripe client metadata derives from shared operations", () => {
  const cases = [
    [stripeCheckoutOptionsGet, getStripeCheckoutOptionsOperation, "options"],
    [stripeCheckoutCreate, createStripeCheckoutOperation, "checkout"],
    [
      stripeCheckoutSessionCreate,
      createStripeCheckoutSessionOperation,
      "checkout-session",
    ],
    [stripePortalCreate, createStripePortalOperation, "portal"],
    [stripeSubscriptionCancel, cancelStripeSubscriptionOperation, "cancel"],
  ] as const;

  for (const [metadata, operation, suffix] of cases) {
    expect(metadata.method).toBe(operation.method);
    expect(metadata.path(organizationId)).toBe(
      `/organizations/${organizationId}/billing/stripe/${suffix}`,
    );
    expect(metadata.isResponse).toBeDefined();
  }
});

test("hosted Stripe client metadata derives request bodies and guards", () => {
  const request = { returnUrl: "https://app.example/billing" };
  expect(stripeCheckoutSessionCreate.body(request.returnUrl)).toEqual(request);
  expect(stripeCheckoutSessionCreate.isRequest(request)).toBe(true);
  expect(stripePortalCreate.body(request.returnUrl)).toEqual(request);
  expect(stripePortalCreate.isRequest(request)).toBe(true);
});

test("Stripe client paths preserve legacy organization id encoding", () => {
  expect(stripeCheckoutOptionsGet.path("organization/1")).toBe(
    "/organizations/organization%2F1/billing/stripe/options",
  );
});

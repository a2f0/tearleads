import { expect, test } from "bun:test";

import {
  REVENUECAT_WEBHOOK_ENV as REVENUECAT_ENV,
  createRespondingFetch as respondingFetch,
  STRIPE_WEBHOOK_ENV as STRIPE_ENV,
  STRIPE_WEBHOOK_SECRET as WEBHOOK_SECRET,
} from "../../../test/helpers/stripeWebhook";
import { getDefaultApiServiceRuntime } from "../runtime";
import {
  authenticateStripeWebhook,
  processAuthenticatedStripeWebhook,
} from "./stripeCheckout";

const PAID_EVENT = {
  type: "invoice.paid",
  data: {
    object: { billing_reason: "subscription_create", subscription: "sub_1" },
  },
};

test("an unsigned delivery is unauthorized and touches nothing", async () => {
  const urls: string[] = [];
  const outcome = await authenticateStripeWebhook(
    { payload: JSON.stringify(PAID_EVENT), signatureHeader: undefined },
    { stripe: { env: STRIPE_ENV, fetchImpl: respondingFetch([], urls) } },
  );
  expect(outcome).toEqual({ status: "unauthorized" });
  expect(urls).toHaveLength(0);
});

test("a subscription without an org binding is recorded as ignored", async () => {
  const urls: string[] = [];
  const outcome = await processAuthenticatedStripeWebhook(
    getDefaultApiServiceRuntime(),
    PAID_EVENT,
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch(
          [{ body: { id: "sub_1", status: "active", metadata: {} } }],
          urls,
        ),
      },
      revenueCat: {
        env: REVENUECAT_ENV,
        fetchImpl: respondingFetch([], urls),
      },
    },
  );
  expect(outcome).toEqual({
    status: "ignored",
    reason: "Subscription carries no org binding",
  });
  // The Stripe binding lookup ran; no RevenueCat call did.
  expect(urls).toHaveLength(1);
});

test("a paid invoice with no Stripe API config asks for redelivery", async () => {
  const outcome = await processAuthenticatedStripeWebhook(
    getDefaultApiServiceRuntime(),
    PAID_EVENT,
    {
      // Webhook secret present, Stripe API key absent: acknowledging with a 2xx
      // would strand the paid subscription forever.
      stripe: { env: { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET } },
    },
  );
  expect(outcome).toEqual({
    status: "retry",
    reason: "Stripe API is not configured",
  });
});

test("a missing webhook secret fails closed", async () => {
  const outcome = await authenticateStripeWebhook(
    { payload: "{}", signatureHeader: "t=1,v1=abc" },
    { stripe: { env: {} } },
  );
  expect(outcome).toEqual({ status: "unconfigured" });
});

test("a 404 subscription on the Stripe webhook is acknowledged as ignored", async () => {
  const urls: string[] = [];
  const notFoundFetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const outcome = await processAuthenticatedStripeWebhook(
    getDefaultApiServiceRuntime(),
    PAID_EVENT,
    {
      stripe: { env: STRIPE_ENV, fetchImpl: notFoundFetch },
      revenueCat: { env: REVENUECAT_ENV },
    },
  );
  // Redelivery cannot make an unfetchable subscription appear; acknowledge
  // instead of looping Stripe's retries forever.
  expect(outcome).toEqual({
    status: "ignored",
    reason: "Subscription not found",
  });
  expect(urls).toHaveLength(1);
});

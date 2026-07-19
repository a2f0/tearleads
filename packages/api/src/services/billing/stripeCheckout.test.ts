import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { processStripeWebhook } from "./stripeCheckout";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const WEBHOOK_SECRET = "whsec_test";
const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_SYNC_PRICE_ID: "price_sync",
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
};
const REVENUECAT_ENV = {
  REVENUECAT_SECRET_API_KEY: "sk_rc",
  REVENUECAT_STRIPE_PUBLIC_API_KEY: "strp_pub",
};

function signedDelivery(event: unknown): {
  payload: string;
  signatureHeader: string;
} {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return { payload, signatureHeader: `t=${timestamp},v1=${signature}` };
}

function respondingFetch(
  responses: Array<{ status?: number; body: unknown }>,
  urls: string[],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(`${init?.method ?? "GET"} ${String(input)}`);
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
    });
  }) as typeof fetch;
}

const PAID_EVENT = {
  type: "invoice.paid",
  data: {
    object: { billing_reason: "subscription_create", subscription: "sub_1" },
  },
};

test("a paid first invoice is associated with RevenueCat", async () => {
  const urls: string[] = [];
  const outcome = await processStripeWebhook(signedDelivery(PAID_EVENT), {
    stripe: {
      env: STRIPE_ENV,
      fetchImpl: respondingFetch(
        [
          {
            body: {
              id: "sub_1",
              status: "active",
              metadata: { userId: "user-1", orgId: ORG_ID },
            },
          },
        ],
        urls,
      ),
    },
    revenueCat: {
      env: REVENUECAT_ENV,
      fetchImpl: respondingFetch([{ body: {} }, { body: {} }], urls),
    },
  });

  expect(outcome).toEqual({
    status: "associated",
    subscriptionId: "sub_1",
    organizationId: ORG_ID,
  });
  expect(urls).toEqual([
    "GET https://api.stripe.com/v1/subscriptions/sub_1",
    "POST https://api.revenuecat.com/v1/subscribers/user-1/attributes",
    "POST https://api.revenuecat.com/v1/receipts",
  ]);
});

test("an unsigned delivery is unauthorized and touches nothing", async () => {
  const urls: string[] = [];
  const outcome = await processStripeWebhook(
    { payload: JSON.stringify(PAID_EVENT), signatureHeader: undefined },
    { stripe: { env: STRIPE_ENV, fetchImpl: respondingFetch([], urls) } },
  );
  expect(outcome).toEqual({ status: "unauthorized" });
  expect(urls).toHaveLength(0);
});

test("a subscription without an org binding is recorded as ignored", async () => {
  const urls: string[] = [];
  const outcome = await processStripeWebhook(signedDelivery(PAID_EVENT), {
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
  });
  expect(outcome).toEqual({
    status: "ignored",
    reason: "Subscription carries no org binding",
  });
  // The Stripe binding lookup ran; no RevenueCat call did.
  expect(urls).toHaveLength(1);
});

test("renewal invoices are ignored — RevenueCat owns the lifecycle", async () => {
  const outcome = await processStripeWebhook(
    signedDelivery({
      type: "invoice.paid",
      data: {
        object: { billing_reason: "subscription_cycle", subscription: "sub_1" },
      },
    }),
    { stripe: { env: STRIPE_ENV, fetchImpl: respondingFetch([], []) } },
  );
  expect(outcome).toEqual({
    status: "ignored",
    reason: "Not a newly paid subscription",
  });
});

test("a missing webhook secret fails closed", async () => {
  const outcome = await processStripeWebhook(
    { payload: "{}", signatureHeader: "t=1,v1=abc" },
    { stripe: { env: {} } },
  );
  expect(outcome).toEqual({ status: "unconfigured" });
});

import { expect, test } from "bun:test";

import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { registerAndAuthenticateWithOrganization } from "../../../test/helpers/registerUser";
import { activeStripePrice } from "../../../test/helpers/stripeCatalog";
import {
  REVENUECAT_WEBHOOK_ENV as REVENUECAT_ENV,
  createRespondingFetch as respondingFetch,
  STRIPE_WEBHOOK_ENV as STRIPE_ENV,
} from "../../../test/helpers/stripeWebhook";
import { getDefaultApiServiceRuntime } from "../runtime";
import {
  createStripeCheckout,
  createStripeCheckoutSession,
} from "./stripeCheckout";

const STRIPE_SOLO_PRICE = activeStripePrice("price_sync", 500);

test("the hosted checkout session returns the Stripe page URL", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const urls: string[] = [];

  const url = await createStripeCheckoutSession(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { priceId: "price_sync", returnUrl: "https://app.example/billing" },
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch(
          [
            { body: { data: [], has_more: false } }, // no Stripe duplicate
            { body: { data: [] } }, // no existing customer
            { body: { id: "cus_new" } }, // customer create
            { body: STRIPE_SOLO_PRICE },
            { body: { url: "https://checkout.stripe.com/pay/cs_1" } },
          ],
          urls,
        ),
      },
      revenueCat: { env: REVENUECAT_ENV },
    },
  );

  expect(url).toBe("https://checkout.stripe.com/pay/cs_1");
  expect(urls.some((u) => u.includes("/v1/checkout/sessions"))).toBe(true);
});

test("the hosted checkout 409s when Stripe already holds a live subscription", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  // The local status can lag Stripe (webhook outage); the Stripe-side search
  // must still catch the live subscription and refuse a second one. The session
  // create must never fire.
  const urls: string[] = [];
  await expect(
    createStripeCheckoutSession(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      { priceId: "price_sync", returnUrl: "https://app.example/billing" },
      {
        stripe: {
          env: STRIPE_ENV,
          fetchImpl: respondingFetch(
            [
              {
                body: {
                  data: [
                    {
                      id: "sub_live",
                      status: "active",
                      customer: "cus_live",
                      metadata: { orgId: organizationId, userId: admin.userId },
                    },
                  ],
                  has_more: false,
                },
              },
            ],
            urls,
          ),
        },
        revenueCat: { env: REVENUECAT_ENV },
      },
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(urls.some((u) => u.includes("/v1/checkout/sessions"))).toBe(false);
});

test("the hosted checkout refuses an already-active organization", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  // Same eligibility guard as the inline checkout — a second subscription
  // would double-bill — and it runs before any Stripe call.
  await db
    .update(organizationBilling)
    .set({ status: "active" })
    .where(eq(organizationBilling.organizationId, organizationId));

  await expect(
    createStripeCheckoutSession(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      { priceId: "price_sync", returnUrl: "https://app.example/billing" },
      {
        stripe: { env: STRIPE_ENV, fetchImpl: respondingFetch([], []) },
        revenueCat: { env: REVENUECAT_ENV },
      },
    ),
  ).rejects.toMatchObject({ status: 409 });
});

test("a Stripe-side live subscription makes checkout a 409", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);

  const fullEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
    STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
    STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
    STRIPE_WEBHOOK_SECRET: "whsec",
    REVENUECAT_V2_SECRET_KEY: "sk_rc",
    REVENUECAT_PROJECT_ID: "proj_1",
    REVENUECAT_STRIPE_PUBLIC_API_KEY: "strp",
  };
  const responses = [
    { data: [{ id: "cus_1" }] },
    // The buyer's own subscriptions: nothing from another attempt to void.
    { data: [], has_more: false },
    STRIPE_SOLO_PRICE,
    { data: [{ id: "sub_live", status: "active" }], has_more: false },
  ];
  const conflictFetch = (async (_input: RequestInfo | URL) =>
    new Response(JSON.stringify(responses.shift() ?? {}))) as typeof fetch;

  // Our billing row may lag (e.g. webhook outage), but Stripe already holds
  // a live subscription for the org — a second checkout would double-bill.
  await expect(
    createStripeCheckout(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      "price_sync",
      {
        stripe: { env: fullEnv, fetchImpl: conflictFetch },
        revenueCat: { env: fullEnv },
      },
    ),
  ).rejects.toMatchObject({ status: 409 });
});

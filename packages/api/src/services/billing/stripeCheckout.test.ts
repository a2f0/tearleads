import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling, users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { addEffectiveOrganizationMember } from "../../../test/helpers/revenuecatWebhook";
import { getDefaultApiServiceRuntime } from "../runtime";
import {
  cancelStripeSubscription,
  createStripeCheckout,
  createStripeCheckoutSession,
  createStripePortalUrl,
  processStripeWebhook,
} from "./stripeCheckout";
import { getStripeCheckoutOptions } from "./stripeCheckoutOptions";

async function registerAndAuthenticate(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);
  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered user row");
  return row.organizationId;
}

const WEBHOOK_SECRET = "whsec_test";
const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
  STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
  STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
};
const REVENUECAT_ENV = {
  REVENUECAT_V2_SECRET_KEY: "sk_rc",
  REVENUECAT_PROJECT_ID: "proj_1",
  REVENUECAT_STRIPE_PUBLIC_API_KEY: "strp_pub",
};
const STRIPE_SOLO_PRICE = {
  currency: "usd",
  id: "price_sync",
  recurring: { interval: "month", interval_count: 1 },
  unit_amount: 500,
};

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

const PAID_EVENT = {
  type: "invoice.paid",
  data: {
    object: { billing_reason: "subscription_create", subscription: "sub_1" },
  },
};

test("an unsigned delivery is unauthorized and touches nothing", async () => {
  const urls: string[] = [];
  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    { payload: JSON.stringify(PAID_EVENT), signatureHeader: undefined },
    { stripe: { env: STRIPE_ENV, fetchImpl: respondingFetch([], urls) } },
  );
  expect(outcome).toEqual({ status: "unauthorized" });
  expect(urls).toHaveLength(0);
});

test("a subscription without an org binding is recorded as ignored", async () => {
  const urls: string[] = [];
  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery(PAID_EVENT),
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
  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery(PAID_EVENT),
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

test("options stay empty until the WHOLE flow is configured", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const urls: string[] = [];
  const result = await getStripeCheckoutOptions(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    {
      stripe: { env: STRIPE_ENV, fetchImpl: respondingFetch([], urls) },
      revenueCat: { env: {} },
    },
  );
  expect(result).toEqual({ options: [] });
  expect(urls).toHaveLength(0);
});

test("options select Team 5 for a two-member effective roster", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await addEffectiveOrganizationMember(organizationId, crypto.randomUUID());
  const urls: string[] = [];

  const result = await getStripeCheckoutOptions(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch(
          [
            {
              body: {
                id: "price_team_5",
                currency: "usd",
                unit_amount: 1_000,
                recurring: { interval: "month", interval_count: 1 },
              },
            },
          ],
          urls,
        ),
      },
      revenueCat: { env: REVENUECAT_ENV },
    },
  );

  expect(result.options).toEqual([
    expect.objectContaining({ tierId: "team_5", seatLimit: 5 }),
  ]);
  expect(urls).toHaveLength(1);
});

test("a missing webhook secret fails closed", async () => {
  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    { payload: "{}", signatureHeader: "t=1,v1=abc" },
    { stripe: { env: {} } },
  );
  expect(outcome).toEqual({ status: "unconfigured" });
});

test("the portal ignores a subscription whose metadata names another org", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
    STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
    STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
  };
  // The subscription is resolved by searching Stripe on our `orgId` metadata.
  // A result whose metadata does NOT match must never yield a portal, so a
  // pooled customer can't expose an unrelated organization's billing.
  const searchFetch = (async (_input: RequestInfo | URL) =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "sub_other",
            status: "active",
            customer: "cus_other",
            metadata: {
              userId: admin.userId,
              orgId: "22222222-2222-4222-8222-222222222222",
            },
          },
        ],
      }),
    )) as typeof fetch;

  const url = await createStripePortalUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    "https://app.example/billing",
    { stripe: { env: stripeEnv, fetchImpl: searchFetch } },
  );
  expect(url).toBeNull();
});

test("the portal returns a session for the org's live subscription", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
    STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
    STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
  };
  const paths: string[] = [];
  const bodies: string[] = [];
  const portalFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    paths.push(path);
    if (path.includes("/subscriptions/search")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "sub_org",
              status: "active",
              customer: "cus_org",
              metadata: { userId: admin.userId, orgId: organizationId },
            },
          ],
        }),
      );
    }
    bodies.push(String(init?.body ?? ""));
    return new Response(
      JSON.stringify({ url: "https://billing.stripe.com/p/session" }),
    );
  }) as typeof fetch;

  const url = await createStripePortalUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    "https://app.example/billing",
    { stripe: { env: stripeEnv, fetchImpl: portalFetch } },
  );
  expect(url).toBe("https://billing.stripe.com/p/session");
  expect(paths.some((path) => path.includes("/billing_portal/sessions"))).toBe(
    true,
  );
  expect(bodies.some((body) => body.includes("customer=cus_org"))).toBe(true);
});

test("cancel schedules the period end for the org's live subscription", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
    STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
    STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
  };
  const paths: string[] = [];
  const cancelFetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    paths.push(path);
    if (path.includes("/subscriptions/search")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "sub_org",
              status: "active",
              customer: "cus_org",
              metadata: { userId: admin.userId, orgId: organizationId },
            },
          ],
        }),
      );
    }
    return new Response(
      JSON.stringify({ id: "sub_org", cancel_at: 1893456000 }),
    );
  }) as typeof fetch;

  const result = await cancelStripeSubscription(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { stripe: { env: stripeEnv, fetchImpl: cancelFetch } },
  );
  expect(result).toEqual({ cancelAt: 1893456000 });
  expect(paths.some((path) => path.endsWith("/subscriptions/sub_org"))).toBe(
    true,
  );
});

test("cancel resolves the Stripe sub_ even when the billing row holds an si_ id", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  // Reproduce the staging state: the RevenueCat webhook wrote the Stripe
  // subscription ITEM id (si_…) to the billing row, not the sub_… . The old
  // resolver read that column and 404'd; the search-based resolver recovers.
  await db
    .update(organizationBilling)
    .set({ providerSubscriptionId: "si_item123", status: "active" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
    STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
    STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
  };
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes("/subscriptions/search")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "sub_real",
              status: "active",
              customer: "cus_real",
              metadata: { userId: admin.userId, orgId: organizationId },
            },
          ],
        }),
      );
    }
    return new Response(
      JSON.stringify({ id: "sub_real", cancel_at: 1893456000 }),
    );
  }) as typeof fetch;

  const result = await cancelStripeSubscription(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { stripe: { env: stripeEnv, fetchImpl } },
  );
  expect(result).toEqual({ cancelAt: 1893456000 });
});

test("cancel does nothing when the org has only an incomplete subscription", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
    STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
    STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
  };
  // An incomplete subscription has nothing to cancel.
  const paths: string[] = [];
  const incompleteFetch = (async (input: RequestInfo | URL) => {
    paths.push(String(input));
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "sub_incomplete",
            status: "incomplete",
            customer: "cus_1",
            metadata: { userId: admin.userId, orgId: organizationId },
          },
        ],
      }),
    );
  }) as typeof fetch;

  const result = await cancelStripeSubscription(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { stripe: { env: stripeEnv, fetchImpl: incompleteFetch } },
  );
  expect(result).toBeNull();
  expect(paths.every((path) => path.includes("/subscriptions/search"))).toBe(
    true,
  );
});

test("the hosted checkout session returns the Stripe page URL", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const urls: string[] = [];

  const url = await createStripeCheckoutSession(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    "https://app.example/billing",
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch(
          [
            { body: { data: [] } }, // Stripe-side duplicate guard: none
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
  const organizationId = await registerAndAuthenticate(admin);
  // The local status can lag Stripe (webhook outage); the Stripe-side search
  // must still catch the live subscription and refuse a second one. The session
  // create must never fire.
  const urls: string[] = [];
  await expect(
    createStripeCheckoutSession(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      "https://app.example/billing",
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
  const organizationId = await registerAndAuthenticate(admin);
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
      "https://app.example/billing",
      {
        stripe: { env: STRIPE_ENV, fetchImpl: respondingFetch([], []) },
        revenueCat: { env: REVENUECAT_ENV },
      },
    ),
  ).rejects.toMatchObject({ status: 409 });
});

test("a Stripe-side live subscription makes checkout a 409", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);

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
    STRIPE_SOLO_PRICE,
    { data: [{ id: "sub_live", status: "active" }] },
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
      {
        stripe: { env: fullEnv, fetchImpl: conflictFetch },
        revenueCat: { env: fullEnv },
      },
    ),
  ).rejects.toMatchObject({ status: 409 });
});

test("a 404 subscription on the Stripe webhook is acknowledged as ignored", async () => {
  const urls: string[] = [];
  const notFoundFetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery(PAID_EVENT),
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

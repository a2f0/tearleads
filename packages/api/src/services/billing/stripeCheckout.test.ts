import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling, users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { getDefaultApiServiceRuntime } from "../runtime";
import {
  cancelStripeSubscription,
  createStripeCheckout,
  createStripePortalUrl,
  getStripeCheckoutOptions,
  processStripeWebhook,
} from "./stripeCheckout";

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

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const WEBHOOK_SECRET = "whsec_test";
const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_SYNC_PRICE_ID: "price_sync",
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
};
const REVENUECAT_ENV = {
  REVENUECAT_V2_SECRET_KEY: "sk_rc",
  REVENUECAT_PROJECT_ID: "proj_1",
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
      fetchImpl: respondingFetch(
        [{ body: {} }, { body: {} }, { body: {} }],
        urls,
      ),
    },
  });

  expect(outcome).toEqual({
    status: "associated",
    subscriptionId: "sub_1",
    organizationId: ORG_ID,
  });
  // The customer must exist before v2 attributes accepts a write, and the
  // receipt (v1, Stripe app key) closes the association.
  expect(urls).toEqual([
    "GET https://api.stripe.com/v1/subscriptions/sub_1",
    "POST https://api.revenuecat.com/v2/projects/proj_1/customers",
    "POST https://api.revenuecat.com/v2/projects/proj_1/customers/user-1/attributes",
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

test("a paid invoice with no Stripe API config asks for redelivery", async () => {
  const outcome = await processStripeWebhook(signedDelivery(PAID_EVENT), {
    // Webhook secret present, Stripe API key absent: acknowledging with a 2xx
    // would strand the paid subscription forever.
    stripe: { env: { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET } },
  });
  expect(outcome).toEqual({
    status: "retry",
    reason: "Stripe API is not configured",
  });
});

test("options stay empty until the WHOLE flow is configured", async () => {
  const urls: string[] = [];
  // Stripe fully configured, RevenueCat association not: offering checkout
  // would charge buyers for subscriptions that can never grant entitlements.
  const result = await getStripeCheckoutOptions({
    stripe: { env: STRIPE_ENV, fetchImpl: respondingFetch([], urls) },
    revenueCat: { env: {} },
  });
  expect(result).toEqual({ options: [] });
  expect(urls).toHaveLength(0);
});

test("a missing webhook secret fails closed", async () => {
  const outcome = await processStripeWebhook(
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
    STRIPE_SYNC_PRICE_ID: "price_sync",
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

test("cancel schedules the period end for the org's live subscription", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_PRICE_ID: "price_sync",
  };
  // 1st call: search resolves the org's live sub. 2nd: the cancel POST.
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
  // The cancel POST targeted the sub_ id found by the search.
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
    STRIPE_SYNC_PRICE_ID: "price_sync",
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
    STRIPE_SYNC_PRICE_ID: "price_sync",
  };
  // An abandoned checkout leaves an `incomplete` subscription: nothing is
  // billing, so there is nothing to cancel and no POST must fire.
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

test("a Stripe-side live subscription makes checkout a 409", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);

  const fullEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_PRICE_ID: "price_sync",
    STRIPE_WEBHOOK_SECRET: "whsec",
    REVENUECAT_V2_SECRET_KEY: "sk_rc",
    REVENUECAT_PROJECT_ID: "proj_1",
    REVENUECAT_STRIPE_PUBLIC_API_KEY: "strp",
  };
  const responses = [
    { data: [{ id: "cus_1" }] },
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
  const outcome = await processStripeWebhook(signedDelivery(PAID_EVENT), {
    stripe: { env: STRIPE_ENV, fetchImpl: notFoundFetch },
    revenueCat: { env: REVENUECAT_ENV },
  });
  // Redelivery cannot make an unfetchable subscription appear; acknowledge
  // instead of looping Stripe's retries forever.
  expect(outcome).toEqual({
    status: "ignored",
    reason: "Subscription not found",
  });
  expect(urls).toHaveLength(1);
});

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

test("the portal refuses a subscription bound to another org", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await db
    .update(organizationBilling)
    .set({ providerSubscriptionId: "sub_org" })
    .where(eq(organizationBilling.organizationId, organizationId));

  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_PRICE_ID: "price_sync",
  };
  const bindingFetch = (orgId: string) =>
    (async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          id: "sub_org",
          status: "active",
          customer: "cus_org",
          metadata: { userId: admin.userId, orgId },
        }),
      )) as typeof fetch;

  // A legacy/foreign subscription (bound to a different org) must not yield
  // a portal: its pooled customer could expose unrelated organizations.
  const mismatched = await createStripePortalUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    "https://app.example/billing",
    {
      stripe: {
        env: stripeEnv,
        fetchImpl: bindingFetch("22222222-2222-4222-8222-222222222222"),
      },
    },
  );
  expect(mismatched).toBeNull();
});

test("cancel schedules the period end for a subscription bound to the org", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await db
    .update(organizationBilling)
    .set({ providerSubscriptionId: "sub_org" })
    .where(eq(organizationBilling.organizationId, organizationId));

  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_PRICE_ID: "price_sync",
  };
  // First call reads the binding (must match THIS org), second performs the
  // cancel and returns the scheduled end.
  let call = 0;
  const cancelFetch = (async (_input: RequestInfo | URL) => {
    call += 1;
    return call === 1
      ? new Response(
          JSON.stringify({
            id: "sub_org",
            status: "active",
            customer: "cus_org",
            metadata: { userId: admin.userId, orgId: organizationId },
          }),
        )
      : new Response(JSON.stringify({ id: "sub_org", cancel_at: 1893456000 }));
  }) as typeof fetch;

  const result = await cancelStripeSubscription(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { stripe: { env: stripeEnv, fetchImpl: cancelFetch } },
  );
  expect(result).toEqual({ cancelAt: 1893456000 });
});

test("cancel refuses a subscription bound to another org", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await db
    .update(organizationBilling)
    .set({ providerSubscriptionId: "sub_org" })
    .where(eq(organizationBilling.organizationId, organizationId));

  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_PRICE_ID: "price_sync",
  };
  // The binding names a DIFFERENT org: cancelling would end an unrelated
  // organization's billing on a pooled customer. Must never reach the cancel
  // request — the same guard the portal enforces.
  let cancelCalls = 0;
  const foreignFetch = (async (_input: RequestInfo | URL) => {
    cancelCalls += 1;
    return new Response(
      JSON.stringify({
        id: "sub_org",
        status: "active",
        customer: "cus_org",
        metadata: {
          userId: admin.userId,
          orgId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    );
  }) as typeof fetch;

  const result = await cancelStripeSubscription(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { stripe: { env: stripeEnv, fetchImpl: foreignFetch } },
  );
  expect(result).toBeNull();
  // Exactly one request (the binding read); the cancel POST never fired.
  expect(cancelCalls).toBe(1);
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

import { expect, test } from "bun:test";
import {
  cancelSubscriptionAtPeriodEnd,
  createCheckoutSession,
  createPortalSession,
  createSyncSubscription,
  findLiveOrgSubscription,
  findOrCreateCustomer,
  getStripeSyncOption,
  getSubscriptionBinding,
  isStripeCheckoutConfigured,
  StripeApiError,
} from "./stripeApi";

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_SYNC_PRICE_ID: "price_sync",
};

interface RecordedRequest {
  url: string;
  method: string;
  body: string | null;
  headers: Headers;
}

function fakeFetch(responses: Array<{ status?: number; body: unknown }>): {
  fetchImpl: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
      headers: new Headers(init?.headers),
    });
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
    });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

test("configuration requires both the secret key and the price id", () => {
  expect(isStripeCheckoutConfigured({ env: ENV })).toBe(true);
  expect(
    isStripeCheckoutConfigured({ env: { STRIPE_SECRET_KEY: "sk_test_123" } }),
  ).toBe(false);
  expect(isStripeCheckoutConfigured({ env: {} })).toBe(false);
});

test("sync option maps the price with its product, pinned API version", async () => {
  const { fetchImpl, requests } = fakeFetch([
    {
      body: {
        id: "price_sync",
        currency: "usd",
        unit_amount: 499,
        recurring: { interval: "month" },
        product: { name: "Sync" },
      },
    },
  ]);
  const option = await getStripeSyncOption({ env: ENV, fetchImpl });

  expect(option).toEqual({
    priceId: "price_sync",
    productName: "Sync",
    currency: "usd",
    unitAmount: 499,
    interval: "month",
  });
  expect(requests[0]?.url).toContain("/v1/prices/price_sync");
  expect(requests[0]?.headers.get("Stripe-Version")).not.toBeNull();
  expect(requests[0]?.headers.get("Authorization")).toBe("Bearer sk_test_123");
});

test("customer lookup reuses an existing metadata match", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: { data: [{ id: "cus_existing" }] } },
  ]);
  const id = await findOrCreateCustomer(
    { userId: "user-1", organizationId: "org-1" },
    { env: ENV, fetchImpl },
  );

  expect(id).toBe("cus_existing");
  expect(requests).toHaveLength(1);
  // Customers are scoped per (user, org): one pooled customer would let one
  // org's Billing Portal expose another org's subscription.
  expect(requests[0]?.url).toContain("/v1/customers/search");
  expect(decodeURIComponent(requests[0]?.url ?? "")).toContain("org-1");
});

test("customer lookup creates one with userId metadata when none exists", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: { data: [] } },
    { body: { id: "cus_new" } },
  ]);
  const id = await findOrCreateCustomer(
    { userId: "user-1", organizationId: "org-1" },
    { env: ENV, fetchImpl },
  );

  expect(id).toBe("cus_new");
  expect(requests[1]?.method).toBe("POST");
  expect(requests[1]?.body).toContain(
    `${encodeURIComponent("metadata[userId]")}=user-1`,
  );
  expect(requests[1]?.body).toContain(
    `${encodeURIComponent("metadata[orgId]")}=org-1`,
  );
});

test("subscription create binds org metadata and returns the client secret", async () => {
  const { fetchImpl, requests } = fakeFetch([
    // No existing subscription for the org, then the create.
    { body: { data: [] } },
    {
      body: {
        id: "sub_1",
        latest_invoice: { payment_intent: { client_secret: "pi_secret" } },
      },
    },
  ]);
  const outcome = await createSyncSubscription(
    { customerId: "cus_1", userId: "user-1", organizationId: "org-1" },
    { env: ENV, fetchImpl },
  );

  expect(outcome).toEqual({
    kind: "ready",
    intent: { subscriptionId: "sub_1", clientSecret: "pi_secret" },
  });
  expect(requests[0]?.url).toContain("/v1/subscriptions/search");
  const body = requests[1]?.body ?? "";
  expect(body).toContain(`${encodeURIComponent("metadata[orgId]")}=org-1`);
  expect(body).toContain(`${encodeURIComponent("metadata[userId]")}=user-1`);
  expect(body).toContain("payment_behavior=default_incomplete");
  // Pinned to card: the Payment Element offers exactly the methods the
  // subscription allows, and any redirect-based method the dashboard happens
  // to enable would break the client's `redirect: "if_required"` confirm.
  expect(body).toContain(
    `${encodeURIComponent("payment_settings[payment_method_types][]")}=card`,
  );
  // Org-scoped: a retried checkout returns the SAME subscription, and two
  // admins racing produce conflicting bodies under one key, which Stripe
  // rejects — the org can never gain two parallel subscriptions.
  expect(requests[1]?.headers.get("Idempotency-Key")).toBe(
    "sync-sub:org-1:price_sync:initial",
  );
});

test("an existing incomplete subscription is resumed, not duplicated", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: { data: [{ id: "sub_pending", status: "incomplete" }] } },
    {
      body: {
        id: "sub_pending",
        status: "incomplete",
        metadata: { userId: "user-1", orgId: "org-1" },
        items: { data: [{ price: { id: "price_sync" } }] },
        latest_invoice: { payment_intent: { client_secret: "pi_resume" } },
      },
    },
  ]);
  const outcome = await createSyncSubscription(
    { customerId: "cus_1", userId: "user-1", organizationId: "org-1" },
    { env: ENV, fetchImpl },
  );

  expect(outcome).toEqual({
    kind: "ready",
    intent: { subscriptionId: "sub_pending", clientSecret: "pi_resume" },
  });
  // Search, then resume — never a create.
  expect(requests).toHaveLength(2);
  expect(requests[1]?.method).toBe("GET");
});

test("a stale pending checkout is a conflict, never cancelled", async () => {
  // The pending attempt belongs to a different buyer (e.g. a since-removed
  // admin) or an obsolete price. It cannot be RESUMED (its buyer/price no
  // longer match) and must not be CANCELLED either — its client secret could
  // be mid-payment in another browser, and Stripe would not refund a
  // subscription that became paid moments before the cancel. The conflict
  // self-resolves when the attempt is paid or expires.
  const { fetchImpl, requests } = fakeFetch([
    { body: { data: [{ id: "sub_stale", status: "incomplete" }] } },
    {
      body: {
        id: "sub_stale",
        status: "incomplete",
        metadata: { userId: "user-gone", orgId: "org-1" },
        items: { data: [{ price: { id: "price_old" } }] },
        latest_invoice: { payment_intent: { client_secret: "pi_stale" } },
      },
    },
  ]);
  const outcome = await createSyncSubscription(
    { customerId: "cus_1", userId: "user-1", organizationId: "org-1" },
    { env: ENV, fetchImpl },
  );

  expect(outcome).toEqual({ kind: "conflict" });
  // Search and inspect only — no cancel, no create.
  expect(requests).toHaveLength(2);
});

test("a live subscription for the org refuses a second checkout", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: { data: [{ id: "sub_live", status: "active" }] } },
  ]);
  const outcome = await createSyncSubscription(
    { customerId: "cus_1", userId: "user-1", organizationId: "org-1" },
    { env: ENV, fetchImpl },
  );

  expect(outcome).toEqual({ kind: "conflict" });
  expect(requests).toHaveLength(1);
});

test("customer creation is idempotency-keyed per user", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: { data: [] } },
    { body: { id: "cus_new" } },
  ]);
  await findOrCreateCustomer(
    { userId: "user-1", organizationId: "org-1" },
    { env: ENV, fetchImpl },
  );
  expect(requests[1]?.headers.get("Idempotency-Key")).toBe(
    "sync-customer:user-1:org-1",
  );
});

test("a candidate that expired since the search is recreated, not resumed", async () => {
  // The search index still reported `incomplete`, but the authoritative GET
  // shows the attempt expired — its old client secret is unusable, so a
  // fresh subscription is created under a rotated key.
  const { fetchImpl, requests } = fakeFetch([
    { body: { data: [{ id: "sub_gone", status: "incomplete" }] } },
    { body: { id: "sub_gone", status: "incomplete_expired" } },
    {
      body: {
        id: "sub_next",
        latest_invoice: { payment_intent: { client_secret: "pi_next" } },
      },
    },
  ]);
  const outcome = await createSyncSubscription(
    { customerId: "cus_1", userId: "user-1", organizationId: "org-1" },
    { env: ENV, fetchImpl },
  );

  expect(outcome).toEqual({
    kind: "ready",
    intent: { subscriptionId: "sub_next", clientSecret: "pi_next" },
  });
  expect(requests[2]?.headers.get("Idempotency-Key")).toBe(
    "sync-sub:org-1:price_sync:sub_gone",
  );
});

test("a candidate that became active since the search is a conflict", async () => {
  const { fetchImpl } = fakeFetch([
    { body: { data: [{ id: "sub_won", status: "incomplete" }] } },
    { body: { id: "sub_won", status: "active" } },
  ]);
  const outcome = await createSyncSubscription(
    { customerId: "cus_1", userId: "user-1", organizationId: "org-1" },
    { env: ENV, fetchImpl },
  );
  expect(outcome).toEqual({ kind: "conflict" });
});

test("a terminal previous attempt rotates the subscription idempotency key", async () => {
  const { fetchImpl, requests } = fakeFetch([
    // Two expired attempts, returned OLDEST-first: the key must rotate off
    // the NEWEST one (search order is not creation order), because the older
    // id may itself be baked into a still-retained idempotency key.
    {
      body: {
        data: [
          { id: "sub_older", status: "incomplete_expired", created: 100 },
          { id: "sub_expired", status: "incomplete_expired", created: 200 },
        ],
      },
    },
    {
      body: {
        id: "sub_2",
        latest_invoice: { payment_intent: { client_secret: "pi_2" } },
      },
    },
  ]);
  const outcome = await createSyncSubscription(
    { customerId: "cus_1", userId: "user-1", organizationId: "org-1" },
    { env: ENV, fetchImpl },
  );

  expect(outcome).toEqual({
    kind: "ready",
    intent: { subscriptionId: "sub_2", clientSecret: "pi_2" },
  });
  expect(requests[1]?.headers.get("Idempotency-Key")).toBe(
    "sync-sub:org-1:price_sync:sub_expired",
  );
});

test("subscription binding reads metadata and status", async () => {
  const { fetchImpl } = fakeFetch([
    {
      body: {
        id: "sub_1",
        status: "active",
        metadata: { userId: "user-1", orgId: "org-1" },
      },
    },
  ]);
  const binding = await getSubscriptionBinding("sub_1", {
    env: ENV,
    fetchImpl,
  });

  expect(binding).toEqual({
    userId: "user-1",
    organizationId: "org-1",
    status: "active",
    customerId: null,
  });
});

test("portal session returns the hosted url", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: { url: "https://billing.stripe.com/p/session" } },
  ]);
  const url = await createPortalSession(
    { customerId: "cus_1", returnUrl: "https://app.example/billing" },
    { env: ENV, fetchImpl },
  );

  expect(url).toBe("https://billing.stripe.com/p/session");
  expect(requests[0]?.body).toContain("customer=cus_1");
});

test("cancelling schedules the end of the paid period, not an instant stop", async () => {
  // `cancel_at_period_end` keeps the sync the buyer already paid for, and lets
  // RevenueCat flip the entitlement through the same path a lapsed renewal
  // takes — an immediate delete would revoke access mid-period.
  const { fetchImpl, requests } = fakeFetch([
    { body: { id: "sub_1", cancel_at: 1893456000 } },
  ]);
  const result = await cancelSubscriptionAtPeriodEnd("sub_1", {
    env: ENV,
    fetchImpl,
  });

  expect(result).toEqual({ cancelAt: 1893456000 });
  expect(requests[0]?.url).toContain("/v1/subscriptions/sub_1");
  expect(requests[0]?.body).toContain("cancel_at_period_end=true");
  expect(requests[0]?.body ?? "").not.toContain("cancel_at_period_end=false");
});

test("a cancellation without a resolved date still reports success", async () => {
  // Stripe omits `cancel_at` on an already-cancelling subscription; the panel
  // must treat that as cancelled rather than as a failure.
  const { fetchImpl } = fakeFetch([{ body: { id: "sub_1" } }]);

  expect(
    await cancelSubscriptionAtPeriodEnd("sub_1", { env: ENV, fetchImpl }),
  ).toEqual({ cancelAt: null });
});

test("a failed Stripe request surfaces as StripeApiError with its status", async () => {
  const { fetchImpl } = fakeFetch([{ status: 500, body: {} }]);
  await expect(
    getStripeSyncOption({ env: ENV, fetchImpl }),
  ).rejects.toBeInstanceOf(StripeApiError);
});

test("unconfigured environments read as null, never a network call", async () => {
  const { fetchImpl, requests } = fakeFetch([]);
  expect(await getStripeSyncOption({ env: {}, fetchImpl })).toBeNull();
  expect(
    await findOrCreateCustomer(
      { userId: "u", organizationId: "o" },
      { env: {}, fetchImpl },
    ),
  ).toBeNull();
  expect(requests).toHaveLength(0);
});

test("findLiveOrgSubscription returns the live sub_ and its customer", async () => {
  const { fetchImpl, requests } = fakeFetch([
    {
      body: {
        data: [
          {
            id: "sub_live",
            status: "active",
            customer: "cus_1",
            metadata: { orgId: "org-1", userId: "user-1" },
          },
        ],
      },
    },
  ]);

  const found = await findLiveOrgSubscription("org-1", { env: ENV, fetchImpl });

  expect(found).toEqual({ subscriptionId: "sub_live", customerId: "cus_1" });
  // Resolved by searching on our own orgId metadata, not a stored id.
  expect(requests[0]?.url).toContain("/v1/subscriptions/search");
  expect(requests[0]?.url).toContain(encodeURIComponent("metadata['orgId']"));
});

test("findLiveOrgSubscription ignores an incomplete-only result", async () => {
  // An abandoned checkout: nothing is billing, so there is nothing to manage.
  const { fetchImpl } = fakeFetch([
    {
      body: {
        data: [
          {
            id: "sub_incomplete",
            status: "incomplete",
            customer: "cus_1",
            metadata: { orgId: "org-1" },
          },
        ],
      },
    },
  ]);

  expect(
    await findLiveOrgSubscription("org-1", { env: ENV, fetchImpl }),
  ).toBeNull();
});

test("findLiveOrgSubscription rejects a result whose metadata names another org", async () => {
  // Defense-in-depth over the metadata search: never hand back a customer
  // whose Billing Portal would expose an unrelated org's subscriptions.
  const { fetchImpl } = fakeFetch([
    {
      body: {
        data: [
          {
            id: "sub_other",
            status: "active",
            customer: "cus_other",
            metadata: { orgId: "org-2" },
          },
        ],
      },
    },
  ]);

  expect(
    await findLiveOrgSubscription("org-1", { env: ENV, fetchImpl }),
  ).toBeNull();
});

test("findLiveOrgSubscription is null without a secret key", async () => {
  const { fetchImpl, requests } = fakeFetch([]);

  expect(
    await findLiveOrgSubscription("org-1", { env: {}, fetchImpl }),
  ).toBeNull();
  // Never reached Stripe.
  expect(requests).toHaveLength(0);
});

test("createCheckoutSession stamps org metadata onto the subscription", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: { url: "https://checkout.stripe.com/pay/cs_1" } },
  ]);

  const url = await createCheckoutSession(
    {
      customerId: "cus_1",
      userId: "user-1",
      organizationId: "org-1",
      successUrl: "https://app.example/billing",
      cancelUrl: "https://app.example/billing",
    },
    { env: ENV, fetchImpl },
  );

  expect(url).toBe("https://checkout.stripe.com/pay/cs_1");
  const body = requests[0]?.body ?? "";
  expect(requests[0]?.url).toContain("/v1/checkout/sessions");
  expect(body).toContain("mode=subscription");
  expect(body).toContain("customer=cus_1");
  // The subscription MUST carry orgId/userId so the webhook can associate it
  // and findLiveOrgSubscription can later resolve it for cancel/portal.
  expect(body).toContain(
    `${encodeURIComponent("subscription_data[metadata][orgId]")}=org-1`,
  );
  expect(body).toContain(
    `${encodeURIComponent("subscription_data[metadata][userId]")}=user-1`,
  );
});

test("createCheckoutSession is null without price/secret config", async () => {
  const { fetchImpl, requests } = fakeFetch([]);

  expect(
    await createCheckoutSession(
      {
        customerId: "cus_1",
        userId: "user-1",
        organizationId: "org-1",
        successUrl: "https://app.example/billing",
        cancelUrl: "https://app.example/billing",
      },
      { env: {}, fetchImpl },
    ),
  ).toBeNull();
  expect(requests).toHaveLength(0);
});

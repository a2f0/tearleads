import { expect, test } from "bun:test";
import {
  createPortalSession,
  createSyncSubscription,
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
  const id = await findOrCreateCustomer("user-1", { env: ENV, fetchImpl });

  expect(id).toBe("cus_existing");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toContain("/v1/customers/search");
});

test("customer lookup creates one with userId metadata when none exists", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: { data: [] } },
    { body: { id: "cus_new" } },
  ]);
  const id = await findOrCreateCustomer("user-1", { env: ENV, fetchImpl });

  expect(id).toBe("cus_new");
  expect(requests[1]?.method).toBe("POST");
  expect(requests[1]?.body).toContain(
    `${encodeURIComponent("metadata[userId]")}=user-1`,
  );
});

test("subscription create binds org metadata and returns the client secret", async () => {
  const { fetchImpl, requests } = fakeFetch([
    {
      body: {
        id: "sub_1",
        latest_invoice: { payment_intent: { client_secret: "pi_secret" } },
      },
    },
  ]);
  const intent = await createSyncSubscription(
    { customerId: "cus_1", userId: "user-1", organizationId: "org-1" },
    { env: ENV, fetchImpl },
  );

  expect(intent).toEqual({
    subscriptionId: "sub_1",
    clientSecret: "pi_secret",
  });
  const body = requests[0]?.body ?? "";
  expect(body).toContain(`${encodeURIComponent("metadata[orgId]")}=org-1`);
  expect(body).toContain(`${encodeURIComponent("metadata[userId]")}=user-1`);
  expect(body).toContain("payment_behavior=default_incomplete");
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

test("a failed Stripe request surfaces as StripeApiError with its status", () => {
  const { fetchImpl } = fakeFetch([{ status: 500, body: {} }]);
  expect(getStripeSyncOption({ env: ENV, fetchImpl })).rejects.toBeInstanceOf(
    StripeApiError,
  );
});

test("unconfigured environments read as null, never a network call", async () => {
  const { fetchImpl, requests } = fakeFetch([]);
  expect(await getStripeSyncOption({ env: {}, fetchImpl })).toBeNull();
  expect(await findOrCreateCustomer("u", { env: {}, fetchImpl })).toBeNull();
  expect(requests).toHaveLength(0);
});

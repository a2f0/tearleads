import { expect, test } from "bun:test";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import {
  fetchActiveRevenueCatNativeSubscription,
  fetchRevenueCatManagementUrl,
} from "./revenueCatApi";
import { classifyRevenueCatEvent } from "./revenuecatWebhook";

const ENV = {
  REVENUECAT_V2_SECRET_KEY: "sk_test",
  REVENUECAT_PROJECT_ID: "proj_1",
} as NodeJS.ProcessEnv;

const NO_REF = { subscriptionId: null, transactionId: null };
const SUBS_URL =
  "https://api.revenuecat.com/v2/projects/proj_1/customers/user-1/subscriptions";

function fakeFetch(pages: Array<{ body: unknown; status?: number }>) {
  const calls: Array<{ url: string; auth: string | null; hasSignal: boolean }> =
    [];
  let index = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      auth: new Headers(init?.headers).get("Authorization"),
      hasSignal: init?.signal != null,
    });
    const page = pages[Math.min(index, pages.length - 1)] ?? { body: {} };
    index++;
    return new Response(JSON.stringify(page.body), {
      status: page.status ?? 200,
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function sub(overrides: Record<string, unknown>) {
  return {
    status: "active",
    gives_access: true,
    management_url: null,
    ...overrides,
  };
}

test("returns null when unconfigured, without calling the API", async () => {
  const { fetchImpl, calls } = fakeFetch([{ body: {} }]);
  expect(
    await fetchRevenueCatManagementUrl("user-1", NO_REF, {
      env: {} as NodeJS.ProcessEnv,
      fetchImpl,
    }),
  ).toBeNull();
  expect(calls).toHaveLength(0);
});

test("uses the sole access-giving subscription with auth and a timeout signal", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { body: { items: [sub({ management_url: "https://manage/x" })] } },
  ]);
  expect(
    await fetchRevenueCatManagementUrl("user-1", NO_REF, {
      env: ENV,
      fetchImpl,
    }),
  ).toBe("https://manage/x");
  expect(calls[0]?.url).toBe(SUBS_URL);
  expect(calls[0]?.auth).toBe("Bearer sk_test");
  expect(calls[0]?.hasSignal).toBe(true);
});

test("matches this org's subscription by store identifier among several", async () => {
  const { fetchImpl } = fakeFetch([
    {
      body: {
        items: [
          sub({
            store_subscription_identifier: "other",
            management_url: "https://other",
          }),
          sub({
            store_subscription_identifier: "txn-9",
            management_url: "https://ours",
          }),
        ],
      },
    },
  ]);
  expect(
    await fetchRevenueCatManagementUrl(
      "user-1",
      { subscriptionId: "txn-9", transactionId: null },
      { env: ENV, fetchImpl },
    ),
  ).toBe("https://ours");
});

test("returns the org's lapsed subscription over another customer's active one", async () => {
  const { fetchImpl } = fakeFetch([
    {
      body: {
        items: [
          sub({
            gives_access: false,
            store_subscription_identifier: "txn-9",
            management_url: "https://ours",
          }),
          sub({
            store_subscription_identifier: "other",
            management_url: "https://other",
          }),
        ],
      },
    },
  ]);
  expect(
    await fetchRevenueCatManagementUrl(
      "user-1",
      { subscriptionId: "txn-9", transactionId: null },
      { env: ENV, fetchImpl },
    ),
  ).toBe("https://ours");
});

test("returns null when the stored id is absent, never falling back", async () => {
  const { fetchImpl } = fakeFetch([
    {
      body: {
        items: [
          sub({
            store_subscription_identifier: "other",
            management_url: "https://other",
          }),
        ],
      },
    },
  ]);
  expect(
    await fetchRevenueCatManagementUrl(
      "user-1",
      { subscriptionId: "txn-9", transactionId: null },
      { env: ENV, fetchImpl },
    ),
  ).toBeNull();
});

test("returns null when multiple subscriptions are ambiguous (no id match)", async () => {
  const { fetchImpl } = fakeFetch([
    {
      body: {
        items: [
          sub({
            store_subscription_identifier: "a",
            management_url: "https://a",
          }),
          sub({
            store_subscription_identifier: "b",
            management_url: "https://b",
          }),
        ],
      },
    },
  ]);
  expect(
    await fetchRevenueCatManagementUrl("user-1", NO_REF, {
      env: ENV,
      fetchImpl,
    }),
  ).toBeNull();
});

test("follows pagination to find the matching subscription", async () => {
  const { fetchImpl, calls } = fakeFetch([
    {
      body: {
        items: [
          sub({
            store_subscription_identifier: "a",
            management_url: "https://a",
          }),
        ],
        next_page:
          "/v2/projects/proj_1/customers/user-1/subscriptions?starting_after=a",
      },
    },
    {
      body: {
        items: [
          sub({
            store_subscription_identifier: "txn-9",
            management_url: "https://ours",
          }),
        ],
      },
    },
  ]);
  expect(
    await fetchRevenueCatManagementUrl(
      "user-1",
      { subscriptionId: "txn-9", transactionId: null },
      { env: ENV, fetchImpl },
    ),
  ).toBe("https://ours");
  expect(calls).toHaveLength(2);
  expect(calls[1]?.url).toBe(`${SUBS_URL}?starting_after=a`);
});

test("returns null when nothing gives access or exposes a URL", async () => {
  const { fetchImpl } = fakeFetch([
    {
      body: {
        items: [sub({ gives_access: false, management_url: "https://x" })],
      },
    },
  ]);
  expect(
    await fetchRevenueCatManagementUrl("user-1", NO_REF, {
      env: ENV,
      fetchImpl,
    }),
  ).toBeNull();
});

test("does not fall back to a sole subscription from an incomplete list", async () => {
  const { fetchImpl } = fakeFetch([
    {
      body: {
        items: [
          sub({
            store_subscription_identifier: "a",
            management_url: "https://a",
          }),
        ],
        next_page:
          "/v2/projects/proj_1/customers/user-1/subscriptions?starting_after=a",
      },
    },
    { body: {}, status: 500 },
  ]);
  expect(
    await fetchRevenueCatManagementUrl("user-1", NO_REF, {
      env: ENV,
      fetchImpl,
    }),
  ).toBeNull();
});

test("treats a later-page 404 as incomplete, not a complete empty list", async () => {
  const { fetchImpl } = fakeFetch([
    {
      body: {
        items: [
          sub({
            store_subscription_identifier: "a",
            management_url: "https://a",
          }),
        ],
        next_page:
          "/v2/projects/proj_1/customers/user-1/subscriptions?starting_after=a",
      },
    },
    { body: { message: "gone" }, status: 404 },
  ]);
  expect(
    await fetchRevenueCatManagementUrl("user-1", NO_REF, {
      env: ENV,
      fetchImpl,
    }),
  ).toBeNull();
});

test("returns null for a missing customer (404) or a server error", async () => {
  expect(
    await fetchRevenueCatManagementUrl("user-1", NO_REF, {
      env: ENV,
      fetchImpl: fakeFetch([{ body: { message: "not found" }, status: 404 }])
        .fetchImpl,
    }),
  ).toBeNull();
  expect(
    await fetchRevenueCatManagementUrl("user-1", NO_REF, {
      env: ENV,
      fetchImpl: fakeFetch([{ body: {}, status: 500 }]).fetchImpl,
    }),
  ).toBeNull();
});

test("returns null (never throws) when the request errors", async () => {
  const fetchImpl = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  expect(
    await fetchRevenueCatManagementUrl("user-1", NO_REF, {
      env: ENV,
      fetchImpl,
    }),
  ).toBeNull();
});

test("resolves one verified native subscription and its store product", async () => {
  const { fetchImpl, calls } = fakeFetch([
    {
      body: {
        items: [
          sub({
            current_period_ends_at: "2030-02-01T00:00:00Z",
            current_period_starts_at: "2030-01-01T00:00:00Z",
            environment: "production",
            product_id: "prod_1",
            store: "play_store",
            store_subscription_identifier: "GPA.1-2-3-4",
          }),
        ],
      },
    },
    { body: { store_identifier: "sync_team_5_monthly:monthly" } },
  ]);

  expect(
    await fetchActiveRevenueCatNativeSubscription("user-1", "play_store", {
      env: ENV,
      fetchImpl,
    }),
  ).toEqual({
    kind: "found",
    subscription: {
      currentPeriodEndsAt: new Date("2030-02-01T00:00:00Z"),
      currentPeriodStartsAt: new Date("2030-01-01T00:00:00Z"),
      productId: "sync_team_5_monthly:monthly",
      store: "play_store",
      subscriptionId: "GPA.1-2-3-4",
    },
  });
  expect(calls[1]?.url).toBe(
    "https://api.revenuecat.com/v2/projects/proj_1/products/prod_1",
  );
});

test("native verification and lifecycle events use the same store identifier", async () => {
  const cases = [
    ["app_store", "APP_STORE", "2000000123456789"],
    ["play_store", "PLAY_STORE", "GPA.1234-5678-9012-34567"],
  ] as const;
  for (const [store, webhookStore, subscriptionId] of cases) {
    const { fetchImpl } = fakeFetch([
      {
        body: {
          items: [
            sub({
              environment: "production",
              product_id: "prod_solo",
              store,
              store_subscription_identifier: subscriptionId,
            }),
          ],
        },
      },
      { body: { store_identifier: "sync_solo_monthly:monthly" } },
    ]);
    const resolved = await fetchActiveRevenueCatNativeSubscription(
      "user-1",
      store,
      { env: ENV, fetchImpl },
    );
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") throw new Error("expected subscription");
    const now = Date.now();
    const event: RevenueCatWebhookEvent = {
      app_user_id: "user-1",
      entitlement_ids: ["sync"],
      event_timestamp_ms: now,
      expiration_at_ms: now + 60_000,
      id: crypto.randomUUID(),
      original_transaction_id: subscriptionId,
      product_id: "sync_solo_monthly:monthly",
      purchased_at_ms: now,
      store: webhookStore,
      type: "INITIAL_PURCHASE",
    };
    const transition = classifyRevenueCatEvent(event, new Date(now));
    expect(transition.kind).toBe("grant");
    if (transition.kind === "grant") {
      expect(transition.fields.providerSubscriptionId).toBe(
        resolved.subscription.subscriptionId,
      );
    }
  }
});

test("native verification rejects missing, ambiguous, and disallowed sandbox receipts", async () => {
  const active = (identifier: string) =>
    sub({
      environment: "production",
      product_id: `prod_${identifier}`,
      store: "app_store",
      store_subscription_identifier: identifier,
    });
  expect(
    await fetchActiveRevenueCatNativeSubscription("user-1", "play_store", {
      env: ENV,
      fetchImpl: fakeFetch([{ body: { items: [active("a")] } }]).fetchImpl,
    }),
  ).toEqual({ kind: "not_found" });
  expect(
    await fetchActiveRevenueCatNativeSubscription("user-1", "app_store", {
      env: ENV,
      fetchImpl: fakeFetch([{ body: { items: [active("a"), active("b")] } }])
        .fetchImpl,
    }),
  ).toEqual({ kind: "ambiguous" });
  expect(
    await fetchActiveRevenueCatNativeSubscription("user-1", "app_store", {
      env: ENV,
      fetchImpl: fakeFetch([
        {
          body: {
            items: [{ ...active("a"), environment: "sandbox" }],
          },
        },
      ]).fetchImpl,
    }),
  ).toEqual({ kind: "not_found" });
});

test("native verification rejects Test Store outside a sandbox-enabled tier", async () => {
  const { fetchImpl, calls } = fakeFetch([{ body: { items: [] } }]);
  expect(
    await fetchActiveRevenueCatNativeSubscription("user-1", "test_store", {
      env: ENV,
      fetchImpl,
    }),
  ).toEqual({ kind: "not_found" });
  expect(calls).toHaveLength(0);
});

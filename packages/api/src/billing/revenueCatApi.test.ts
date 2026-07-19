import { expect, test } from "bun:test";
import { fetchRevenueCatManagementUrl } from "./revenueCatApi";

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

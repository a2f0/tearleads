import { describe, expect, test } from "bun:test";
import { workersFetch } from "../../test/helpers/workersFetch";
import {
  fetchActiveRevenueCatNativeSubscription,
  fetchRevenueCatManagementUrl,
  verifyRevenueCatPlaySubscriptionReplacement,
} from "./revenueCatApi";

/**
 * Malformed RevenueCat v2 responses: each subscription field is read on its
 * own, and an unusable page, item, or product reads as absent.
 */

const ENV: NodeJS.ProcessEnv = {
  REVENUECAT_V2_SECRET_KEY: "sk_test",
  REVENUECAT_PROJECT_ID: "proj_1",
};

const NO_REF = { subscriptionId: null, transactionId: null };

const ACTIVE = {
  id: "sub_rc",
  object: "subscription",
  customer_id: "user-1",
  gives_access: true,
  store: "play_store",
  environment: "production",
  product_id: "prod_1",
  store_subscription_identifier: "GPA.1",
  current_period_starts_at: "2030-01-01T00:00:00Z",
  current_period_ends_at: "2030-02-01T00:00:00Z",
  management_url: "https://manage/x",
};

const PRODUCT = { store_identifier: "sync_team_5_monthly:monthly" };

function queuedFetch(bodies: unknown[]) {
  const urls: string[] = [];
  const fetchImpl = workersFetch(async (input) => {
    urls.push(String(input));
    const body = bodies.length > 0 ? bodies.shift() : {};
    return new Response(JSON.stringify(body));
  });
  return { fetchImpl, urls };
}

async function activeFor(page: unknown, product: unknown = PRODUCT) {
  const { fetchImpl } = queuedFetch([page, product]);
  return fetchActiveRevenueCatNativeSubscription("user-1", "play_store", {
    env: ENV,
    fetchImpl,
  });
}

const FOUND = {
  kind: "found" as const,
  subscription: {
    currentPeriodEndsAt: new Date("2030-02-01T00:00:00Z"),
    currentPeriodStartsAt: new Date("2030-01-01T00:00:00Z"),
    productId: "sync_team_5_monthly:monthly",
    store: "play_store" as const,
    subscriptionId: "GPA.1",
  },
};

describe("customer subscription pages", () => {
  const emptyPages: readonly unknown[] = [
    null,
    5,
    "items",
    [],
    [ACTIVE],
    {},
    { items: {} },
    { items: "x" },
    { items: { 0: ACTIVE } },
    { items: [null, 5, "x", [], {}] },
  ];

  test.each(emptyPages.map((page) => [page]))(
    "page %j has no active subscription",
    async (page) => {
      expect(await activeFor(page)).toEqual({ kind: "not_found" });
    },
  );

  test("unreadable items beside a readable one are skipped", async () => {
    expect(
      await activeFor({ items: [null, 5, [], ACTIVE], next_page: null }),
    ).toEqual(FOUND);
  });

  const inactive: readonly unknown[] = [
    { ...ACTIVE, gives_access: "true" },
    { ...ACTIVE, gives_access: 1 },
    { ...ACTIVE, gives_access: null },
    { ...ACTIVE, store: 5 },
    { ...ACTIVE, store: "" },
    { ...ACTIVE, store: "app_store" },
    { ...ACTIVE, environment: "SANDBOX" },
  ];

  test.each(inactive.map((item) => [item]))(
    "item %j is not an active match",
    async (item) => {
      expect(await activeFor({ items: [item] })).toEqual({
        kind: "not_found",
      });
    },
  );

  const unavailable: readonly unknown[] = [
    { ...ACTIVE, product_id: "" },
    { ...ACTIVE, product_id: 5 },
    { ...ACTIVE, store_subscription_identifier: "" },
    { ...ACTIVE, store_subscription_identifier: ["GPA.1"] },
  ];

  test.each(unavailable.map((item) => [item]))(
    "item %j cannot be resolved",
    async (item) => {
      expect(await activeFor({ items: [item] })).toEqual({
        kind: "unavailable",
      });
    },
  );

  test("each malformed field reads as null beside readable siblings", async () => {
    expect(
      await activeFor({
        items: [
          {
            ...ACTIVE,
            store: "PLAY_STORE",
            environment: 5,
            current_period_starts_at: 1_893_456_000_000,
            current_period_ends_at: "not a date",
          },
        ],
      }),
    ).toEqual({
      kind: "found",
      subscription: {
        ...FOUND.subscription,
        currentPeriodEndsAt: null,
        currentPeriodStartsAt: null,
      },
    });
  });

  test.each([
    [null],
    [5],
    [[]],
    [{}],
    [{ store_identifier: "" }],
    [{ store_identifier: 5 }],
  ])("product %j is unavailable", async (product) => {
    expect(await activeFor({ items: [ACTIVE] }, product)).toEqual({
      kind: "unavailable",
    });
  });

  test("a product with extra keys resolves", async () => {
    expect(
      await activeFor(
        { items: [ACTIVE] },
        { ...PRODUCT, display_name: "Sync", id: "prod_1" },
      ),
    ).toEqual(FOUND);
  });

  test.each([[5], [""], [null], [{ href: "/next" }]])(
    "next page %j ends pagination",
    async (nextPage) => {
      const { fetchImpl, urls } = queuedFetch([
        { items: [], next_page: nextPage },
      ]);
      expect(
        await fetchActiveRevenueCatNativeSubscription("user-1", "play_store", {
          env: ENV,
          fetchImpl,
        }),
      ).toEqual({ kind: "not_found" });
      expect(urls).toHaveLength(1);
    },
  );

  test("a page with unreadable items still follows its next page", async () => {
    const { fetchImpl, urls } = queuedFetch([
      { items: "x", next_page: "/v2/projects/proj_1/next" },
      { items: [ACTIVE] },
      PRODUCT,
    ]);
    expect(
      await fetchActiveRevenueCatNativeSubscription("user-1", "play_store", {
        env: ENV,
        fetchImpl,
      }),
    ).toEqual(FOUND);
    expect(urls[1]).toBe("https://api.revenuecat.com/v2/projects/proj_1/next");
  });
});

describe("management URLs", () => {
  test.each([
    [{ management_url: "https://manage/y" }, "https://manage/y"],
    [{ management_url: "" }, null],
    [{ management_url: 5 }, null],
    [{ management_url: null }, null],
    [{ gives_access: "true" }, null],
  ])("subscription %j manages at %p", async (fields, url) => {
    const { fetchImpl } = queuedFetch([{ items: [{ ...ACTIVE, ...fields }] }]);
    expect(
      await fetchRevenueCatManagementUrl("user-1", NO_REF, {
        env: ENV,
        fetchImpl,
      }),
    ).toBe(url);
  });

  test.each([
    [{ store_subscription_identifier: "GPA.1" }, "https://manage/x"],
    [{ store_subscription_identifier: "" }, null],
    [{ store_subscription_identifier: 1 }, null],
  ])("a stored reference matches %j at %p", async (fields, url) => {
    const { fetchImpl } = queuedFetch([{ items: [{ ...ACTIVE, ...fields }] }]);
    expect(
      await fetchRevenueCatManagementUrl(
        "user-1",
        { subscriptionId: "GPA.1", transactionId: null },
        { env: ENV, fetchImpl },
      ),
    ).toBe(url);
  });
});

describe("Play replacement identifier searches", () => {
  const INPUT = {
    appUserId: "user-1",
    predecessorSubscriptionId: "GPA.old",
    productId: "sync_team_5_monthly:monthly",
    replacementSubscriptionId: "GPA.1",
  };

  async function verify(predecessor: unknown, replacement: unknown) {
    const fetchImpl = workersFetch(async (input) => {
      const url = new URL(String(input));
      const identifier = url.searchParams.get("store_subscription_identifier");
      const body = url.pathname.endsWith("/products/prod_1")
        ? PRODUCT
        : identifier === INPUT.predecessorSubscriptionId
          ? predecessor
          : replacement;
      return new Response(JSON.stringify(body));
    });
    return verifyRevenueCatPlaySubscriptionReplacement(INPUT, {
      env: ENV,
      fetchImpl,
    });
  }

  test("one readable subscription behind both identifiers verifies", async () => {
    expect(
      await verify(
        { items: [{ ...ACTIVE, gives_access: false, product_id: 5 }] },
        { items: [ACTIVE] },
      ),
    ).toEqual({ kind: "verified" });
  });

  test.each([
    [{ items: [{ ...ACTIVE, id: "" }] }, { items: [{ ...ACTIVE, id: "" }] }],
    [{ items: [{ ...ACTIVE, id: 5 }] }, { items: [{ ...ACTIVE, id: 5 }] }],
    [{ items: [{ ...ACTIVE, customer_id: 1 }] }, { items: [ACTIVE] }],
    [{ items: [ACTIVE] }, { items: [{ ...ACTIVE, store: null }] }],
    [{ items: [ACTIVE] }, { items: [{ ...ACTIVE, gives_access: "yes" }] }],
    [{ items: [ACTIVE] }, { items: [{ ...ACTIVE, product_id: "" }] }],
    [{ items: [ACTIVE] }, { items: "x" }],
    [null, { items: [ACTIVE] }],
  ])(
    "predecessor %j and replacement %j are not one subscription",
    async (predecessor, replacement) => {
      expect(await verify(predecessor, replacement)).toEqual({
        kind: "not_found",
      });
    },
  );
});

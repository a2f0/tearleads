import { describe, expect, test } from "bun:test";
import {
  STRIPE_PAYLOAD_CHECKOUT as CHECKOUT,
  STRIPE_PAYLOAD_ENV as ENV,
  NON_OBJECT_PAYLOADS as NON_OBJECTS,
  STRIPE_PAYLOAD_PRICE as PRICE,
  queuedStripeFetch as queuedFetch,
  stripeSearchPage as searchPage,
} from "../../test/helpers/stripePayloadFetch";
import {
  createSyncSubscription,
  findLiveOrgSubscription,
  findOrCreateCustomer,
  hasOpenOrgSubscription,
  StripeApiError,
} from "./stripeApi";

/**
 * Malformed Stripe response tables: each malformed field reads as missing,
 * without failing sibling fields, and outcomes match the hand-rolled readers.
 */

describe("customer search and create responses", () => {
  const unusableSearches: readonly unknown[] = [
    ...NON_OBJECTS,
    {},
    { data: [] },
    { data: {} },
    { data: { 0: { id: "cus_found" } } },
    { data: [null] },
    { data: [["cus_found"]] },
    { data: ["cus_found"] },
    { data: [{}] },
    { data: [{ id: "" }] },
    { data: [{ id: 5 }] },
    { data: [{ id: null }] },
  ];

  test.each(unusableSearches.map((body) => [body]))(
    "search %j creates a customer",
    async (body) => {
      const { fetchImpl, requests } = queuedFetch([body, { id: "cus_new" }]);
      expect(
        await findOrCreateCustomer(
          { userId: "user-1", organizationId: "org-1" },
          { env: ENV, fetchImpl },
        ),
      ).toBe("cus_new");
      expect(requests.map((request) => request.method)).toEqual([
        "GET",
        "POST",
      ]);
    },
  );

  test("a usable first match with extra keys and trailing items is reused", async () => {
    const { fetchImpl, requests } = queuedFetch([
      {
        data: [{ id: "cus_found", email: null }, 5, null],
        object: "search_result",
      },
    ]);
    expect(
      await findOrCreateCustomer(
        { userId: "user-1", organizationId: "org-1" },
        { env: ENV, fetchImpl },
      ),
    ).toBe("cus_found");
    expect(requests).toHaveLength(1);
  });

  test.each(
    [...NON_OBJECTS, {}, { id: "" }, { id: 5 }, { id: { id: "cus_1" } }].map(
      (body) => [body],
    ),
  )("an unreadable created customer %j is a 502", async (body) => {
    const { fetchImpl } = queuedFetch([{ data: [] }, body]);
    const error = await findOrCreateCustomer(
      { userId: "user-1", organizationId: "org-1" },
      { env: ENV, fetchImpl },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StripeApiError);
    expect(error).toMatchObject({ status: 502 });
  });
});

describe("subscription create responses", () => {
  const unreadableIntents: readonly unknown[] = [
    ...NON_OBJECTS,
    { latest_invoice: { payment_intent: { client_secret: "secret" } } },
    { id: "", latest_invoice: { payment_intent: { client_secret: "s" } } },
    { id: 5, latest_invoice: { payment_intent: { client_secret: "s" } } },
    { id: "sub_1" },
    { id: "sub_1", latest_invoice: "in_1" },
    { id: "sub_1", latest_invoice: [] },
    { id: "sub_1", latest_invoice: { payment_intent: "pi_1" } },
    { id: "sub_1", latest_invoice: { payment_intent: null } },
    { id: "sub_1", latest_invoice: { payment_intent: { client_secret: "" } } },
    { id: "sub_1", latest_invoice: { payment_intent: { client_secret: 1 } } },
  ];

  test.each(unreadableIntents.map((body) => [body]))(
    "an unreadable intent %j is a 502",
    async (body) => {
      const { fetchImpl } = queuedFetch([PRICE, searchPage([]), body]);
      const error = await createSyncSubscription(CHECKOUT, {
        env: ENV,
        fetchImpl,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(StripeApiError);
      expect(error).toMatchObject({ status: 502 });
    },
  );

  test("an intent with extra provider keys is ready", async () => {
    const { fetchImpl } = queuedFetch([
      PRICE,
      searchPage([]),
      {
        id: "sub_1",
        object: "subscription",
        latest_invoice: {
          id: "in_1",
          payment_intent: { client_secret: "secret_1", status: "x" },
        },
      },
    ]);
    expect(
      await createSyncSubscription(CHECKOUT, { env: ENV, fetchImpl }),
    ).toEqual({
      kind: "ready",
      intent: { subscriptionId: "sub_1", clientSecret: "secret_1" },
    });
  });
});

const MATCHING_PENDING = {
  id: "sub_pending",
  status: "incomplete",
  metadata: { checkoutAttemptId: "attempt-1", userId: "user-1" },
  items: { data: [{ price: { id: "price_sync" }, quantity: 1 }] },
  latest_invoice: { payment_intent: { client_secret: "secret_pending" } },
};

async function resumeOutcome(pending: unknown) {
  const { fetchImpl, requests } = queuedFetch([
    PRICE,
    searchPage([{ id: "sub_pending", status: "incomplete" }]),
    pending,
    {
      id: "sub_new",
      latest_invoice: { payment_intent: { client_secret: "secret_new" } },
    },
  ]);
  const outcome = await createSyncSubscription(CHECKOUT, {
    env: ENV,
    fetchImpl,
  });
  return {
    outcome,
    created: requests.some(
      (request) =>
        request.method === "POST" && request.url.endsWith("/v1/subscriptions"),
    ),
  };
}

describe("pending subscription resume responses", () => {
  test("a matching pending checkout with extra keys is resumed", async () => {
    expect(
      await resumeOutcome({ ...MATCHING_PENDING, livemode: false }),
    ).toEqual({
      outcome: {
        kind: "ready",
        intent: {
          subscriptionId: "sub_pending",
          clientSecret: "secret_pending",
        },
      },
      created: false,
    });
  });

  const conflicting: readonly unknown[] = [
    { ...MATCHING_PENDING, metadata: { checkoutAttemptId: "attempt-1" } },
    {
      ...MATCHING_PENDING,
      metadata: { checkoutAttemptId: "attempt-1", userId: 5 },
    },
    { ...MATCHING_PENDING, metadata: null },
    { ...MATCHING_PENDING, items: { data: [] } },
    { ...MATCHING_PENDING, items: { data: {} } },
    { ...MATCHING_PENDING, items: [] },
    {
      ...MATCHING_PENDING,
      items: { data: [{ price: "price_sync", quantity: 1 }] },
    },
    {
      ...MATCHING_PENDING,
      items: { data: [{ price: { id: "price_sync" }, quantity: "1" }] },
    },
    {
      ...MATCHING_PENDING,
      items: { data: [{ price: { id: "price_sync" }, quantity: 2 }] },
    },
    { ...MATCHING_PENDING, latest_invoice: null },
    { ...MATCHING_PENDING, id: 5 },
    { ...MATCHING_PENDING, status: "active" },
    // An unreadable status still reads this attempt's id: it was used.
    { ...MATCHING_PENDING, status: 5 },
    { ...MATCHING_PENDING, status: "" },
    // The terminal branch reads the attempt id independently of userId.
    {
      ...MATCHING_PENDING,
      status: "canceled",
      metadata: { checkoutAttemptId: "attempt-1", userId: 5 },
    },
  ];

  test.each(conflicting.map((pending) => [pending]))(
    "pending %j is a conflict",
    async (pending) => {
      expect(await resumeOutcome(pending)).toEqual({
        outcome: { kind: "conflict" },
        created: false,
      });
    },
  );

  const recreated: readonly unknown[] = [
    ...NON_OBJECTS,
    {},
    { ...MATCHING_PENDING, status: "canceled", metadata: null },
    { ...MATCHING_PENDING, status: 5, metadata: { checkoutAttemptId: "x" } },
    { ...MATCHING_PENDING, status: "", metadata: {} },
    {
      ...MATCHING_PENDING,
      status: "incomplete_expired",
      metadata: { checkoutAttemptId: 7 },
    },
    {
      ...MATCHING_PENDING,
      status: "incomplete_expired",
      metadata: { checkoutAttemptId: "attempt-0" },
    },
  ];

  test.each(recreated.map((pending) => [pending]))(
    "pending %j is replaced by a new subscription",
    async (pending) => {
      expect(await resumeOutcome(pending)).toEqual({
        outcome: {
          kind: "ready",
          intent: { subscriptionId: "sub_new", clientSecret: "secret_new" },
        },
        created: true,
      });
    },
  );
});

describe("organization subscription search items", () => {
  const ignoredItems: readonly unknown[] = [
    ...NON_OBJECTS,
    {},
    { id: "sub_x" },
    { status: "active" },
    { id: "", status: "active" },
    { id: 5, status: "active" },
    { id: "sub_x", status: "" },
    { id: "sub_x", status: ["active"] },
    { id: "sub_x", status: "canceled", metadata: null },
    { id: "sub_x", status: "canceled", metadata: { checkoutAttemptId: 1 } },
    { id: "sub_x", status: "canceled", metadata: ["attempt-1"] },
  ];

  test.each(ignoredItems.map((item) => [item]))(
    "item %j does not block checkout",
    async (item) => {
      const { fetchImpl } = queuedFetch([
        PRICE,
        searchPage([item]),
        {
          id: "sub_new",
          latest_invoice: { payment_intent: { client_secret: "secret_new" } },
        },
      ]);
      expect(
        await createSyncSubscription(CHECKOUT, { env: ENV, fetchImpl }),
      ).toMatchObject({ kind: "ready" });
    },
  );

  const blockingItems: readonly unknown[] = [
    { id: "sub_x", status: "active", extra: true },
    { id: "sub_x", status: "past_due", metadata: 5 },
    {
      id: "sub_x",
      status: "canceled",
      metadata: { checkoutAttemptId: "attempt-1", userId: 5 },
    },
  ];

  test.each(blockingItems.map((item) => [item]))(
    "item %j conflicts",
    async (item) => {
      const { fetchImpl } = queuedFetch([PRICE, searchPage([item])]);
      expect(
        await createSyncSubscription(CHECKOUT, { env: ENV, fetchImpl }),
      ).toEqual({ kind: "conflict" });
    },
  );

  const liveItem = {
    id: "sub_live",
    status: "active",
    customer: "cus_1",
    metadata: { orgId: "org-1" },
  };
  const liveCases: ReadonlyArray<
    readonly [unknown, { subscriptionId: string; customerId: string } | null]
  > = [
    [liveItem, { subscriptionId: "sub_live", customerId: "cus_1" }],
    [
      { ...liveItem, customer: { id: "cus_2", email: 5 } },
      { subscriptionId: "sub_live", customerId: "cus_2" },
    ],
    [{ ...liveItem, customer: { id: "" } }, null],
    [{ ...liveItem, customer: "" }, null],
    [{ ...liveItem, customer: 5 }, null],
    [{ ...liveItem, customer: ["cus_1"] }, null],
    [{ ...liveItem, metadata: {} }, null],
    [{ ...liveItem, metadata: { orgId: 1 } }, null],
    [{ ...liveItem, metadata: { orgId: "org-2" } }, null],
    [{ ...liveItem, metadata: [] }, null],
    [{ ...liveItem, status: "incomplete" }, null],
    [{ ...liveItem, status: 1 }, null],
    [{ ...liveItem, id: "" }, null],
    [null, null],
  ];

  test.each(liveCases)("live resolver reads %j as %j", async (item, result) => {
    const { fetchImpl } = queuedFetch([searchPage([item])]);
    expect(
      await findLiveOrgSubscription("org-1", { env: ENV, fetchImpl }),
    ).toEqual(result);
  });

  const inspectCases: ReadonlyArray<readonly [unknown, boolean]> = [
    [{ status: "incomplete" }, true],
    [{ status: "active", extra: 1 }, true],
    [{ status: "canceled" }, false],
    [{ status: "" }, false],
    [{ status: 5 }, false],
    [{}, false],
    [null, false],
    [[], false],
  ];

  test.each(inspectCases)(
    "an inspected incomplete candidate %j is open: %p",
    async (body, open) => {
      const { fetchImpl } = queuedFetch([
        searchPage([{ id: "sub_pending", status: "incomplete" }]),
        body,
      ]);
      expect(
        await hasOpenOrgSubscription("org-1", { env: ENV, fetchImpl }),
      ).toBe(open);
    },
  );
});

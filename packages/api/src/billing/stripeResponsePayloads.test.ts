import { describe, expect, spyOn, test } from "bun:test";
import {
  STRIPE_PAYLOAD_CHECKOUT as CHECKOUT,
  STRIPE_PAYLOAD_ENV as ENV,
  STRIPE_PAYLOAD_PRICE as PRICE,
  queuedStripeFetch as queuedFetch,
} from "../../test/helpers/stripePayloadFetch";
import {
  cancelSubscriptionAtPeriodEnd,
  createCheckoutSession,
  createPortalSession,
  findLiveOrgSubscription,
  getStripeSyncOption,
  StripeApiError,
} from "./stripeApi";

/**
 * Malformed Stripe pagination, single-field, and Price responses: outcomes and
 * operator diagnostics match the hand-rolled readers.
 */

describe("subscription search pagination", () => {
  const invalidPages: ReadonlyArray<readonly [unknown, string]> = [
    [null, "invalid data"],
    [[], "invalid data"],
    ["page", "invalid data"],
    [{}, "invalid data"],
    [{ data: {}, has_more: false }, "invalid data"],
    [{ data: "x", has_more: false }, "invalid data"],
    [{ data: [] }, "invalid has_more"],
    [{ data: [], has_more: "false" }, "invalid has_more"],
    [{ data: [], has_more: null }, "invalid has_more"],
    [{ data: [], has_more: true }, "missing next_page"],
    [{ data: [], has_more: true, next_page: "" }, "missing next_page"],
    [{ data: [], has_more: true, next_page: 2 }, "missing next_page"],
  ];

  test.each(invalidPages)("page %j is rejected (%s)", async (page, reason) => {
    const { fetchImpl } = queuedFetch([page]);
    const error = await findLiveOrgSubscription("org-1", {
      env: ENV,
      fetchImpl,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StripeApiError);
    expect(error).toMatchObject({
      message: `Stripe subscription search (${reason}) failed with status 502`,
      status: 502,
    });
  });

  test("a page with extra keys follows its cursor", async () => {
    const { fetchImpl, requests } = queuedFetch([
      { data: [], has_more: true, next_page: "cursor_2", url: "/x" },
      { data: [], has_more: false, next_page: 9 },
    ]);
    expect(
      await findLiveOrgSubscription("org-1", { env: ENV, fetchImpl }),
    ).toBeNull();
    expect(requests[1]?.url).toContain("&page=cursor_2");
  });
});

describe("single-field responses", () => {
  const cancelCases: ReadonlyArray<readonly [unknown, number | null]> = [
    [{ cancel_at: 1_800_000_000, id: "sub_1" }, 1_800_000_000],
    [{ cancel_at: 0 }, 0],
    [{ cancel_at: -1.5 }, -1.5],
    [{ cancel_at: "1800000000" }, null],
    [{ cancel_at: null }, null],
    [{}, null],
    [null, null],
    [[], null],
  ];

  test.each(cancelCases)("cancel response %j reads %p", async (body, at) => {
    const { fetchImpl } = queuedFetch([body]);
    expect(
      await cancelSubscriptionAtPeriodEnd("sub_1", { env: ENV, fetchImpl }),
    ).toEqual({ cancelAt: at });
  });

  const urlCases: ReadonlyArray<readonly [unknown, string | null]> = [
    [{ url: "https://stripe.test/x", id: "bps_1" }, "https://stripe.test/x"],
    [{ url: "" }, null],
    [{ url: 5 }, null],
    [{ url: { href: "https://stripe.test/x" } }, null],
    [{}, null],
    [null, null],
    [["https://stripe.test/x"], null],
  ];

  test.each(urlCases)("portal response %j reads %p", async (body, url) => {
    const { fetchImpl } = queuedFetch([body]);
    expect(
      await createPortalSession(
        { customerId: "cus_1", returnUrl: "https://app.test/billing" },
        { env: ENV, fetchImpl },
      ),
    ).toBe(url);
  });

  test.each(urlCases)("checkout response %j reads %p", async (body, url) => {
    const { fetchImpl } = queuedFetch([PRICE, body]);
    expect(
      await createCheckoutSession(
        {
          ...CHECKOUT,
          expiresAt: new Date("2030-01-01T00:00:00Z"),
          returnUrl: "https://app.test/billing",
        },
        { env: ENV, fetchImpl },
      ),
    ).toBe(url);
  });
});

describe("configured price responses", () => {
  async function priceDiagnostics(body: unknown) {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { fetchImpl } = queuedFetch([body]);
      const option = await getStripeSyncOption("team_5", {
        env: ENV,
        fetchImpl,
      });
      return { option, logs: errorSpy.mock.calls };
    } finally {
      errorSpy.mockRestore();
    }
  }

  function unusable(reason: string, productId?: string) {
    return [
      "Configured Stripe catalog entry is unusable",
      {
        priceId: "price_sync",
        ...(productId ? { productId } : {}),
        reason,
        tierId: "team_5",
      },
    ];
  }

  const rejected: ReadonlyArray<readonly [unknown, unknown[]]> = [
    [null, unusable("Price lookup returned an invalid response")],
    [5, unusable("Price lookup returned an invalid response")],
    ["price", unusable("Price lookup returned an invalid response")],
    [[], unusable("Price active state is missing or invalid")],
    [{}, unusable("Price active state is missing or invalid")],
    [
      { ...PRICE, active: "true" },
      unusable("Price active state is missing or invalid"),
    ],
    [
      { ...PRICE, active: 1 },
      unusable("Price active state is missing or invalid"),
    ],
    [{ ...PRICE, active: false }, unusable("Price is inactive")],
    [
      { ...PRICE, product: "prod_sync" },
      unusable("Expanded Product is missing or invalid"),
    ],
    [
      { ...PRICE, product: null },
      unusable("Expanded Product is missing or invalid"),
    ],
    [
      { ...PRICE, product: [] },
      unusable("Expanded Product is missing or invalid"),
    ],
    [
      { ...PRICE, product: { id: "prod_sync", active: "yes" } },
      unusable("Expanded Product is missing or invalid"),
    ],
    [
      { ...PRICE, product: { id: "", active: true } },
      unusable("Expanded Product is missing or invalid"),
    ],
    [
      { ...PRICE, product: { id: 5, active: true } },
      unusable("Expanded Product is missing or invalid"),
    ],
    [
      { ...PRICE, product: { id: "prod_sync", active: false } },
      unusable("Product is inactive", "prod_sync"),
    ],
  ];

  test.each(rejected)("price %j logs %j", async (body, log) => {
    const { option, logs } = await priceDiagnostics(body);
    expect(option).toBeNull();
    expect(logs).toEqual([log]);
  });

  const mismatchCases: ReadonlyArray<readonly [unknown, unknown]> = [
    [
      // Absent keys read as missing, like malformed ones.
      { active: true, product: PRICE.product },
      {
        currency: null,
        interval: null,
        intervalCount: null,
        priceId: null,
        unitAmount: null,
      },
    ],
    [
      { ...PRICE, unit_amount: "1000" },
      {
        currency: "usd",
        interval: "month",
        intervalCount: 1,
        priceId: "price_sync",
        unitAmount: null,
      },
    ],
    [
      { ...PRICE, unit_amount: 0 },
      {
        currency: "usd",
        interval: "month",
        intervalCount: 1,
        priceId: "price_sync",
        unitAmount: null,
      },
    ],
    [
      { ...PRICE, unit_amount: 2 ** 53 },
      {
        currency: "usd",
        interval: "month",
        intervalCount: 1,
        priceId: "price_sync",
        unitAmount: null,
      },
    ],
    [
      { ...PRICE, currency: 840 },
      {
        currency: null,
        interval: "month",
        intervalCount: 1,
        priceId: "price_sync",
        unitAmount: 1_000,
      },
    ],
    [
      { ...PRICE, id: "" },
      {
        currency: "usd",
        interval: "month",
        intervalCount: 1,
        priceId: null,
        unitAmount: 1_000,
      },
    ],
    [
      { ...PRICE, recurring: { interval: "month", interval_count: 1.5 } },
      {
        currency: "usd",
        interval: "month",
        intervalCount: null,
        priceId: "price_sync",
        unitAmount: 1_000,
      },
    ],
    [
      { ...PRICE, recurring: { interval: 30, interval_count: 1 } },
      {
        currency: "usd",
        interval: null,
        intervalCount: 1,
        priceId: "price_sync",
        unitAmount: 1_000,
      },
    ],
    [
      { ...PRICE, recurring: "month" },
      {
        currency: "usd",
        interval: null,
        intervalCount: null,
        priceId: "price_sync",
        unitAmount: 1_000,
      },
    ],
  ];

  test.each(mismatchCases)(
    "price %j reports each readable field (%j)",
    async (body, actual) => {
      const { option, logs } = await priceDiagnostics(body);
      expect(option).toBeNull();
      expect(logs).toEqual([
        [
          "Configured Stripe Price does not match its billing tier",
          {
            actual,
            expected: {
              currency: "usd",
              interval: "month",
              intervalCount: 1,
              priceId: "price_sync",
              unitAmount: 1_000,
            },
            tierId: "team_5",
          },
        ],
      ]);
    },
  );

  test("a valid price with extra provider keys is accepted", async () => {
    const { option, logs } = await priceDiagnostics({
      ...PRICE,
      object: "price",
      product: { ...PRICE.product, name: "Sync" },
    });
    expect(logs).toEqual([]);
    expect(option).toMatchObject({ priceId: "price_sync", unitAmount: 1_000 });
  });
});

import { describe, expect, spyOn, test } from "bun:test";
import { workersFetch } from "../../test/helpers/workersFetch";
import { getSubscriptionBinding } from "./stripeSubscriptionBinding";
import {
  extractPaidInvoiceLineList,
  extractPaidSubscriptionId,
  extractPaidSubscriptionInvoice,
} from "./stripeWebhook";

/**
 * Field-by-field Stripe snapshots: every field is read on its own, so one
 * malformed field reads as null without hiding its readable siblings.
 */

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
};

async function bindingFor(body: unknown) {
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  try {
    const fetchImpl = workersFetch(
      async () => new Response(JSON.stringify(body)),
    );
    const binding = await getSubscriptionBinding("sub_1", {
      env: ENV,
      fetchImpl,
    });
    return { binding, logs: errorSpy.mock.calls.map((call) => call[0]) };
  } finally {
    errorSpy.mockRestore();
  }
}

const NULL_BINDING = {
  billingPeriodEndsAt: null,
  billingPeriodStartsAt: null,
  currency: null,
  customerEmail: null,
  customerId: null,
  interval: null,
  intervalCount: null,
  organizationId: null,
  paymentMethodBillingEmail: null,
  priceId: null,
  seatQuantity: null,
  status: null,
  subscriptionItemId: null,
  unitAmount: null,
  userId: null,
};

const NO_ITEM_LOG =
  "Stripe subscription sub_1 has no item matching the configured fixed-tier Prices; observed: none";

describe("subscription binding responses", () => {
  test.each([[null], [5], ["sub_1"], [true]])(
    "a non-object response %j has no binding",
    async (body) => {
      expect((await bindingFor(body)).binding).toBeNull();
    },
  );

  test.each([[[]], [{}], [{ items: null }], [{ items: { data: {} } }]])(
    "an object response %j without a sync item reads every field as null",
    async (body) => {
      expect(await bindingFor(body)).toEqual({
        binding: NULL_BINDING,
        logs: [NO_ITEM_LOG],
      });
    },
  );

  test("each malformed field reads as null beside readable siblings", async () => {
    const result = await bindingFor({
      status: 5,
      customer: { id: 7, email: "customer@example.com" },
      default_payment_method: { billing_details: { email: "" } },
      current_period_start: "1767225600",
      current_period_end: 1e300,
      metadata: { orgId: ["org-1"], userId: "user-1" },
      items: {
        data: [
          { id: "si_other", price: "price_sync", quantity: 1 },
          { id: "si_none", price: { id: 5 }, quantity: 1 },
          {
            id: "si_1",
            quantity: 1,
            price: {
              id: "price_sync",
              currency: "",
              recurring: { interval: "month", interval_count: 0 },
              unit_amount: -1,
            },
          },
        ],
      },
    });
    expect(result).toEqual({
      binding: {
        ...NULL_BINDING,
        customerEmail: "customer@example.com",
        interval: "month",
        priceId: "price_sync",
        seatQuantity: 1,
        subscriptionItemId: "si_1",
        userId: "user-1",
      },
      logs: [],
    });
  });

  test("a string customer is its id and expanded fields read through", async () => {
    const result = await bindingFor({
      status: "active",
      customer: "cus_1",
      default_payment_method: "pm_1",
      current_period_start: 1_767_225_600,
      current_period_end: 1_769_904_000,
      metadata: { orgId: "org-1", userId: 9, extra: true },
      items: {
        object: "list",
        data: [
          {
            id: "si_1",
            quantity: 1,
            price: {
              id: "price_sync",
              currency: "usd",
              recurring: { interval: 3, interval_count: 2.5 },
              unit_amount: 1.5,
            },
          },
        ],
      },
    });
    expect(result).toEqual({
      binding: {
        ...NULL_BINDING,
        billingPeriodEndsAt: new Date("2026-02-01T00:00:00.000Z"),
        billingPeriodStartsAt: new Date("2026-01-01T00:00:00.000Z"),
        currency: "usd",
        customerId: "cus_1",
        organizationId: "org-1",
        priceId: "price_sync",
        seatQuantity: 1,
        status: "active",
        subscriptionItemId: "si_1",
      },
      logs: [],
    });
  });

  test.each([
    [{ quantity: "1" }, "invalid quantity null"],
    [{ quantity: 0 }, "invalid quantity null"],
    [{ quantity: 2 }, "invalid quantity 2"],
    [{}, "invalid quantity null"],
  ])("a sync item %j has no seat capacity (%s)", async (item, message) => {
    const result = await bindingFor({
      items: { data: [{ id: "si_1", price: { id: "price_sync" }, ...item }] },
    });
    expect(result.binding).toMatchObject({
      priceId: "price_sync",
      seatQuantity: null,
      subscriptionItemId: "si_1",
    });
    expect(result.logs).toEqual([
      `Stripe subscription sub_1 has ${message}; fixed-tier subscriptions require quantity 1`,
    ]);
  });

  test("observed price ids skip unreadable items in the rotation alert", async () => {
    const result = await bindingFor({
      items: {
        data: [
          { price: { id: "price_old" } },
          { price: { id: "" } },
          { price: "price_sync" },
          null,
        ],
      },
    });
    expect(result.logs).toEqual([
      "Stripe subscription sub_1 has no item matching the configured fixed-tier Prices; observed: price_old",
    ]);
  });
});

const PAID_INVOICE = {
  id: "in_1",
  amount_paid: 1_000,
  billing_reason: "subscription_cycle",
  currency: "usd",
  subscription: "sub_1",
  status_transitions: { paid_at: 1_767_225_600 },
  lines: { data: [], has_more: false },
};

function paidEvent(invoice: unknown, event: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    type: "invoice.paid",
    created: 1_767_312_000,
    data: { object: invoice },
    ...event,
  };
}

const PROCESSING_TIME = new Date("2030-01-01T00:00:00.000Z");

function invoiceFrom(event: unknown) {
  return extractPaidSubscriptionInvoice(event, PROCESSING_TIME);
}

describe("paid invoice events", () => {
  const ignoredEvents: readonly unknown[] = [
    null,
    5,
    [],
    {},
    paidEvent(PAID_INVOICE, { type: "invoice.created" }),
    paidEvent(PAID_INVOICE, { type: 5 }),
    paidEvent(PAID_INVOICE, { data: null }),
    paidEvent(PAID_INVOICE, { data: [] }),
    paidEvent(null),
    paidEvent([]),
    paidEvent({ ...PAID_INVOICE, billing_reason: "subscription_refresh" }),
    paidEvent({ ...PAID_INVOICE, billing_reason: "" }),
    paidEvent({ ...PAID_INVOICE, billing_reason: 1 }),
    paidEvent({ ...PAID_INVOICE, subscription: null }),
    paidEvent({ ...PAID_INVOICE, subscription: "" }),
    paidEvent({ ...PAID_INVOICE, subscription: { id: "" } }),
    paidEvent({ ...PAID_INVOICE, subscription: ["sub_1"] }),
    paidEvent({
      ...PAID_INVOICE,
      subscription: undefined,
      parent: { subscription_details: { subscription: 5 } },
    }),
  ];

  test.each(ignoredEvents.map((event) => [event]))(
    "event %j is not a paid subscription invoice",
    (event) => {
      expect(invoiceFrom(event)).toBeNull();
      expect(extractPaidSubscriptionId(event)).toBeNull();
    },
  );

  const subscriptionCases: ReadonlyArray<readonly [unknown, string]> = [
    [{ subscription: { id: "sub_2", object: "subscription" } }, "sub_2"],
    [
      {
        subscription: { id: 5 },
        parent: { subscription_details: { subscription: "sub_3" } },
      },
      "sub_3",
    ],
    [
      {
        subscription: undefined,
        parent: { subscription_details: { subscription: { id: "sub_4" } } },
      },
      "sub_4",
    ],
  ];

  test.each(subscriptionCases)(
    "invoice %j names subscription %s",
    (fields, subscriptionId) => {
      expect(
        invoiceFrom(paidEvent({ ...PAID_INVOICE, ...(fields as object) })),
      ).toMatchObject({ subscriptionId });
    },
  );

  test("malformed invoice fields read as null beside readable siblings", () => {
    expect(
      invoiceFrom(
        paidEvent(
          {
            ...PAID_INVOICE,
            id: 5,
            amount_paid: -1,
            currency: "",
            status_transitions: { paid_at: "1767225600" },
            lines: null,
          },
          { id: "" },
        ),
      ),
    ).toEqual({
      amountPaid: null,
      billingReason: "subscription_cycle",
      currency: null,
      invoiceId: null,
      lines: [],
      linesHasMore: null,
      occurredAt: new Date("2026-01-02T00:00:00.000Z"),
      providerEventId: null,
      subscriptionId: "sub_1",
    });
  });

  test.each([
    [{ status_transitions: null }, { created: "x" }],
    [{ status_transitions: { paid_at: 1e300 } }, { created: 1e300 }],
    [{ status_transitions: [] }, { created: null }],
  ])(
    "invoice %j and event %j fall back to the processing time",
    (invoice, event) => {
      expect(
        invoiceFrom(paidEvent({ ...PAID_INVOICE, ...invoice }, event))
          ?.occurredAt,
      ).toEqual(PROCESSING_TIME);
    },
  );

  test("a creation invoice with extra keys yields its subscription id", () => {
    expect(
      extractPaidSubscriptionId(
        paidEvent(
          {
            ...PAID_INVOICE,
            billing_reason: "subscription_create",
            livemode: true,
          },
          { api_version: "2024-06-20" },
        ),
      ),
    ).toBe("sub_1");
  });
});

const NULL_LINE = {
  currency: null,
  id: null,
  interval: null,
  intervalCount: null,
  periodEndsAt: null,
  periodStartsAt: null,
  priceId: null,
  proration: null,
  quantity: null,
  subscriptionId: null,
  subscriptionItemId: null,
  unitAmount: null,
};

describe("invoice line lists", () => {
  const listCases: ReadonlyArray<
    readonly [unknown, ReturnType<typeof extractPaidInvoiceLineList>]
  > = [
    [null, { hasMore: null, lines: [] }],
    [5, { hasMore: null, lines: [] }],
    [[], { hasMore: null, lines: [] }],
    [{}, { hasMore: null, lines: [] }],
    [
      { data: {}, has_more: "false" },
      { hasMore: null, lines: [] },
    ],
    [
      { data: [], has_more: true },
      { hasMore: true, lines: [] },
    ],
    [
      { lines: null, has_more: false },
      { hasMore: null, lines: [] },
    ],
    [
      { lines: [], data: [{}] },
      { hasMore: null, lines: [] },
    ],
    [
      { lines: { data: [null, 5], has_more: false } },
      { hasMore: false, lines: [NULL_LINE, NULL_LINE] },
    ],
    [
      { data: [[]], has_more: false, url: "/v1/invoices/in_1/lines" },
      { hasMore: false, lines: [NULL_LINE] },
    ],
  ];

  test.each(listCases)("line list %j reads as %j", (value, expected) => {
    expect(extractPaidInvoiceLineList(value)).toEqual(expected);
  });

  function lineFrom(line: unknown) {
    return extractPaidInvoiceLineList({ data: [line], has_more: false })
      .lines[0];
  }

  test("each line field falls through to its first readable source", () => {
    expect(
      lineFrom({
        id: "il_1",
        currency: 5,
        price: {
          id: "",
          currency: "",
          recurring: { interval: 1, interval_count: 0 },
          unit_amount: -5,
          unit_amount_decimal: "12.5",
        },
        pricing: {
          unit_amount_decimal: "99999999999999999999",
          price_details: {
            price: {
              id: "price_2",
              currency: "usd",
              recurring: { interval: "", interval_count: 2 },
              unit_amount: 1.5,
              unit_amount_decimal: "1200.00",
            },
            currency: "eur",
            recurring: { interval: "month", interval_count: 3 },
            unit_amount_decimal: 7.5,
          },
        },
        parent: {
          subscription_item_details: {
            proration: "true",
            subscription: { id: "" },
            subscription_item: 5,
          },
          invoice_item_details: {
            proration: false,
            subscription: { id: "sub_9" },
            subscription_item: { id: "si_9" },
          },
        },
        proration: null,
        period: { start: "1", end: 1_769_904_000 },
        quantity: 0,
      }),
    ).toEqual({
      currency: "usd",
      id: "il_1",
      interval: "month",
      intervalCount: 2,
      periodEndsAt: new Date("2026-02-01T00:00:00.000Z"),
      periodStartsAt: null,
      priceId: "price_2",
      proration: false,
      quantity: null,
      subscriptionId: "sub_9",
      subscriptionItemId: "si_9",
      unitAmount: 1_200,
    });
  });

  test.each([
    [{ price: { unit_amount: 1_000 } }, 1_000],
    [{ price: { unit_amount: "1000" } }, 1_000],
    [{ price: { unit_amount: 7, unit_amount_decimal: "9" } }, 7],
    [{ price: { unit_amount: 7.5, unit_amount_decimal: "9" } }, 9],
    [{ price: { unit_amount_decimal: "1000" } }, 1_000],
    [{ price: { unit_amount_decimal: "1000.000" } }, 1_000],
    [{ price: { unit_amount_decimal: "1000." } }, null],
    [{ price: { unit_amount_decimal: "-1" } }, null],
    [{ price: { unit_amount_decimal: " 1" } }, null],
    [{ price: { unit_amount_decimal: "1e3" } }, null],
    [{ price: { unit_amount_decimal: "9007199254740992" } }, null],
    [{ price: { unit_amount_decimal: "9007199254740991" } }, 9007199254740991],
    [{ price: { unit_amount: 2 ** 53 } }, null],
    [{ price: "price_1" }, null],
  ])("line %j has unit amount %p", (line, unitAmount) => {
    expect(lineFrom(line)?.unitAmount).toBe(unitAmount);
  });

  test("string resource references read as ids", () => {
    expect(
      lineFrom({
        price: "price_1",
        subscription: "sub_1",
        subscription_item: "si_1",
        proration: true,
        quantity: 1,
      }),
    ).toEqual({
      ...NULL_LINE,
      priceId: "price_1",
      proration: true,
      quantity: 1,
      subscriptionId: "sub_1",
      subscriptionItemId: "si_1",
    });
  });
});

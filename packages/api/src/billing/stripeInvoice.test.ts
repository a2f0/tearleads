import { expect, test } from "bun:test";
import { getPaidSubscriptionInvoice } from "./stripeInvoice";

const ENV = { STRIPE_SECRET_KEY: "sk_test_123" };

function fakeFetch(responses: unknown[]): {
  readonly fetchImpl: typeof fetch;
  readonly urls: string[];
} {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(responses.shift() ?? {}));
  }) as typeof fetch;
  return { fetchImpl, urls };
}

function invoiceBody(lines: unknown): unknown {
  return {
    id: "in_paged",
    amount_paid: 499,
    billing_reason: "subscription_cycle",
    currency: "usd",
    lines,
    subscription: "sub_paged",
  };
}

function prorationLine(index: number): unknown {
  return {
    id: `il_proration_${String(index).padStart(3, "0")}`,
    parent: {
      type: "invoice_item_details",
      invoice_item_details: {
        proration: true,
        subscription: "sub_paged",
      },
    },
  };
}

test("uses an explicitly complete embedded invoice line list", async () => {
  const { fetchImpl, urls } = fakeFetch([
    invoiceBody({
      data: [{ id: "il_embedded", quantity: 1 }],
      has_more: false,
    }),
  ]);

  const invoice = await getPaidSubscriptionInvoice("in_paged", {
    env: ENV,
    fetchImpl,
  });

  expect(invoice?.lines.map((line) => line.id)).toEqual(["il_embedded"]);
  expect(invoice?.linesHasMore).toBe(false);
  expect(urls).toEqual(["https://api.stripe.com/v1/invoices/in_paged"]);
});

test("uses the webhook occurrence as the pinned lookup fallback", async () => {
  const { fetchImpl } = fakeFetch([invoiceBody({ data: [], has_more: false })]);
  const occurredAt = new Date("2026-07-01T12:34:56.000Z");

  const invoice = await getPaidSubscriptionInvoice(
    "in_paged",
    { env: ENV, fetchImpl },
    occurredAt,
  );

  expect(invoice?.occurredAt).toEqual(occurredAt);
});

test("replaces a truncated embed with every paginated invoice line", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    prorationLine(index + 1),
  );
  const historicalSeatLine = {
    id: "il_historical_seat",
    currency: "usd",
    parent: {
      type: "subscription_item_details",
      subscription_item_details: {
        proration: false,
        subscription: "sub_paged",
        subscription_item: "si_paged",
      },
    },
    period: { start: 1_783_123_456, end: 1_785_715_456 },
    price: { id: "price_sync", unit_amount: 499 },
    quantity: 1,
  };
  const { fetchImpl, urls } = fakeFetch([
    invoiceBody({
      data: Array.from({ length: 10 }, (_, index) => prorationLine(index + 1)),
      has_more: true,
    }),
    { data: firstPage, has_more: true },
    { data: [historicalSeatLine], has_more: false },
  ]);

  const invoice = await getPaidSubscriptionInvoice("in_paged", {
    env: ENV,
    fetchImpl,
  });

  expect(invoice?.lines).toHaveLength(101);
  expect(invoice?.lines[100]).toMatchObject({
    id: "il_historical_seat",
    priceId: "price_sync",
    proration: false,
    quantity: 1,
    subscriptionId: "sub_paged",
    subscriptionItemId: "si_paged",
  });
  expect(invoice?.linesHasMore).toBe(false);
  expect(urls).toEqual([
    "https://api.stripe.com/v1/invoices/in_paged",
    "https://api.stripe.com/v1/invoices/in_paged/lines?limit=100",
    "https://api.stripe.com/v1/invoices/in_paged/lines?limit=100&starting_after=il_proration_100",
  ]);
});

test("rejects a continued line page without a cursor", async () => {
  const { fetchImpl, urls } = fakeFetch([
    invoiceBody({ data: [], has_more: true }),
    { data: [{ quantity: 1 }], has_more: true },
  ]);

  expect(
    await getPaidSubscriptionInvoice("in_paged", { env: ENV, fetchImpl }),
  ).toBeNull();
  expect(urls).toHaveLength(2);
});

test("fetches the line endpoint when embedded pagination is indeterminate", async () => {
  const { fetchImpl, urls } = fakeFetch([
    invoiceBody({ data: [{ id: "il_embedded" }] }),
    { data: [{ id: "il_complete", quantity: 2 }], has_more: false },
  ]);

  const invoice = await getPaidSubscriptionInvoice("in_paged", {
    env: ENV,
    fetchImpl,
  });

  expect(invoice?.lines.map((line) => line.id)).toEqual(["il_complete"]);
  expect(invoice?.linesHasMore).toBe(false);
  expect(urls).toHaveLength(2);
});

test("rejects a repeated line-page cursor", async () => {
  const { fetchImpl, urls } = fakeFetch([
    invoiceBody({ data: [], has_more: true }),
    { data: [{ id: "il_repeat" }], has_more: true },
    { data: [{ id: "il_repeat" }], has_more: true },
  ]);

  expect(
    await getPaidSubscriptionInvoice("in_paged", { env: ENV, fetchImpl }),
  ).toBeNull();
  expect(urls).toHaveLength(3);
});

test("bounds pathological invoice line pagination", async () => {
  const pages = Array.from({ length: 100 }, (_, index) => ({
    data: [{ id: `il_page_${index}` }],
    has_more: true,
  }));
  const { fetchImpl, urls } = fakeFetch([
    invoiceBody({ data: [], has_more: true }),
    ...pages,
  ]);

  expect(
    await getPaidSubscriptionInvoice("in_paged", { env: ENV, fetchImpl }),
  ).toBeNull();
  expect(urls).toHaveLength(101);
});

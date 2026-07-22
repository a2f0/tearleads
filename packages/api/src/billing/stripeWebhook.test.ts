import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  extractPaidInvoiceLineList,
  extractPaidSubscriptionId,
  extractPaidSubscriptionInvoice,
  type StripeInvoiceBillingReason,
  verifyStripeSignature,
} from "./stripeWebhook";

const SECRET = "whsec_test";

function sign(payload: string, timestampSeconds: number): string {
  const signature = createHmac("sha256", SECRET)
    .update(`${timestampSeconds}.${payload}`)
    .digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

test("accepts a fresh, correctly signed payload", () => {
  const payload = JSON.stringify({ type: "invoice.paid" });
  const timestamp = 1_700_000_000;
  expect(
    verifyStripeSignature({
      payload,
      signatureHeader: sign(payload, timestamp),
      secret: SECRET,
      nowMs: timestamp * 1000 + 60_000,
    }),
  ).toBe(true);
});

test("rejects a bad signature, a stale timestamp, and a missing header", () => {
  const payload = JSON.stringify({ type: "invoice.paid" });
  const timestamp = 1_700_000_000;
  expect(
    verifyStripeSignature({
      payload: `${payload} tampered`,
      signatureHeader: sign(payload, timestamp),
      secret: SECRET,
      nowMs: timestamp * 1000,
    }),
  ).toBe(false);
  expect(
    verifyStripeSignature({
      payload,
      signatureHeader: sign(payload, timestamp),
      secret: SECRET,
      // Beyond the five-minute replay tolerance.
      nowMs: timestamp * 1000 + 6 * 60 * 1000,
    }),
  ).toBe(false);
  expect(
    verifyStripeSignature({
      payload,
      signatureHeader: undefined,
      secret: SECRET,
      nowMs: timestamp * 1000,
    }),
  ).toBe(false);
});

function paidInvoiceEvent(invoice: Record<string, unknown>): unknown {
  return {
    type: "invoice.paid",
    data: { object: { billing_reason: "subscription_create", ...invoice } },
  };
}

test("extracts the subscription id from both invoice payload shapes", () => {
  // Older API versions: a top-level subscription reference.
  expect(
    extractPaidSubscriptionId(paidInvoiceEvent({ subscription: "sub_old" })),
  ).toBe("sub_old");
  expect(
    extractPaidSubscriptionId(
      paidInvoiceEvent({ subscription: { id: "sub_expanded" } }),
    ),
  ).toBe("sub_expanded");
  // Newer API versions: nested under parent.subscription_details.
  expect(
    extractPaidSubscriptionId(
      paidInvoiceEvent({
        parent: { subscription_details: { subscription: "sub_new" } },
      }),
    ),
  ).toBe("sub_new");
});

test("extracts exact paid-invoice financial and provider event fields", () => {
  const processingTime = new Date("2026-07-04T00:00:00.000Z");
  const invoice = extractPaidSubscriptionInvoice(
    {
      id: "evt_paid_1",
      type: "invoice.paid",
      created: 1_783_126_800,
      data: {
        object: {
          id: "in_paid_1",
          amount_paid: 1497,
          billing_reason: "subscription_cycle",
          currency: "usd",
          status_transitions: { paid_at: 1_783_123_456 },
          subscription: "sub_1",
        },
      },
    },
    processingTime,
  );

  expect(invoice).toEqual({
    amountPaid: 1497,
    billingReason: "subscription_cycle",
    currency: "usd",
    invoiceId: "in_paid_1",
    lines: [],
    linesHasMore: null,
    occurredAt: new Date(1_783_123_456_000),
    providerEventId: "evt_paid_1",
    subscriptionId: "sub_1",
  });
});

test("accepts every Stripe subscription invoice billing reason", () => {
  const billingReasons: readonly StripeInvoiceBillingReason[] = [
    "automatic_pending_invoice_item_invoice",
    "manual",
    "quote_accept",
    "subscription",
    "subscription_create",
    "subscription_cycle",
    "subscription_threshold",
    "subscription_update",
    "upcoming",
  ];

  for (const billingReason of billingReasons) {
    expect(
      extractPaidSubscriptionInvoice({
        type: "invoice.paid",
        data: {
          object: {
            billing_reason: billingReason,
            subscription: `sub_${billingReason}`,
          },
        },
      })?.billingReason,
    ).toBe(billingReason);
  }
});

test("extracts pinned-API invoice line snapshots", () => {
  const invoice = extractPaidSubscriptionInvoice(
    paidInvoiceEvent({
      amount_paid: 1497,
      currency: "usd",
      lines: {
        has_more: false,
        data: [
          {
            currency: "usd",
            id: "il_old",
            period: { start: 1_783_123_456, end: 1_785_715_456 },
            price: {
              currency: "usd",
              id: "price_old",
              recurring: { interval: "month", interval_count: 3 },
              unit_amount: 499,
            },
            proration: false,
            quantity: 3,
            subscription: "sub_old",
            subscription_item: "si_old",
          },
        ],
      },
      subscription: "sub_old",
    }),
  );

  expect(invoice?.lines).toEqual([
    {
      currency: "usd",
      id: "il_old",
      interval: "month",
      intervalCount: 3,
      periodEndsAt: new Date(1_785_715_456_000),
      periodStartsAt: new Date(1_783_123_456_000),
      priceId: "price_old",
      proration: false,
      quantity: 3,
      subscriptionId: "sub_old",
      subscriptionItemId: "si_old",
      unitAmount: 499,
    },
  ]);
});

test("extracts current-API invoice line snapshots", () => {
  const invoice = extractPaidSubscriptionInvoice(
    paidInvoiceEvent({
      lines: {
        has_more: false,
        data: [
          {
            currency: "eur",
            id: "il_new",
            parent: {
              type: "subscription_item_details",
              subscription_item_details: {
                proration: true,
                subscription: "sub_new",
                subscription_item: "si_new",
              },
            },
            period: { start: 1_783_123_456, end: 1_783_987_654 },
            pricing: {
              price_details: { price: "price_new" },
              type: "price_details",
              unit_amount_decimal: "799.000000000000",
            },
            quantity: 4,
          },
        ],
      },
      parent: { subscription_details: { subscription: "sub_new" } },
    }),
  );

  expect(invoice?.lines).toEqual([
    {
      currency: "eur",
      id: "il_new",
      interval: null,
      intervalCount: null,
      periodEndsAt: new Date(1_783_987_654_000),
      periodStartsAt: new Date(1_783_123_456_000),
      priceId: "price_new",
      proration: true,
      quantity: 4,
      subscriptionId: "sub_new",
      subscriptionItemId: "si_new",
      unitAmount: 799,
    },
  ]);
  expect(invoice?.linesHasMore).toBe(false);
});

test("extracts invoice-item parent details from a direct line-list page", () => {
  const lineList = extractPaidInvoiceLineList({
    data: [
      {
        id: "il_invoice_item",
        parent: {
          type: "invoice_item_details",
          invoice_item_details: {
            proration: true,
            subscription: { id: "sub_invoice_item" },
            subscription_item: "si_invoice_item",
          },
        },
      },
    ],
    has_more: true,
  });

  expect(lineList.hasMore).toBe(true);
  expect(lineList.lines[0]).toMatchObject({
    id: "il_invoice_item",
    proration: true,
    subscriptionId: "sub_invoice_item",
    subscriptionItemId: "si_invoice_item",
  });
});

test("rejects negative monetary values and non-positive line quantities", () => {
  const invoice = extractPaidSubscriptionInvoice(
    paidInvoiceEvent({
      amount_paid: -1,
      lines: {
        data: [
          {
            price: { unit_amount: -499 },
            quantity: -3,
            subscription: "sub_negative",
          },
          {
            pricing: { unit_amount_decimal: "-799" },
            quantity: 0,
            subscription: "sub_negative",
          },
        ],
      },
      subscription: "sub_negative",
    }),
  );

  expect(invoice?.amountPaid).toBeNull();
  expect(invoice?.lines.map((line) => line.unitAmount)).toEqual([null, null]);
  expect(invoice?.lines.map((line) => line.quantity)).toEqual([null, null]);

  expect(
    extractPaidSubscriptionInvoice(
      paidInvoiceEvent({ amount_paid: 0, subscription: "sub_free" }),
    )?.amountPaid,
  ).toBe(0);
});

test("paid-invoice occurrence falls back from event time to processing time", () => {
  const processingTime = new Date("2026-07-04T00:00:00.000Z");
  const eventTime = extractPaidSubscriptionInvoice(
    {
      type: "invoice.paid",
      created: 1_783_126_800,
      data: {
        object: {
          billing_reason: "subscription_create",
          subscription: "sub_event_time",
        },
      },
    },
    processingTime,
  );
  const processingFallback = extractPaidSubscriptionInvoice(
    paidInvoiceEvent({ subscription: "sub_processing_time" }),
    processingTime,
  );

  expect(eventTime?.occurredAt).toEqual(new Date(1_783_126_800_000));
  expect(processingFallback?.occurredAt).toEqual(processingTime);
});

test("extractPaidSubscriptionId ignores other events, renewals, and malformed payloads", () => {
  expect(
    extractPaidSubscriptionId({
      type: "invoice.paid",
      data: {
        object: { billing_reason: "subscription_cycle", subscription: "sub" },
      },
    }),
  ).toBeNull();
  expect(
    extractPaidSubscriptionId({
      type: "customer.subscription.updated",
      data: { object: { subscription: "sub" } },
    }),
  ).toBeNull();
  expect(extractPaidSubscriptionId("not an event")).toBeNull();
  expect(extractPaidSubscriptionId(null)).toBeNull();
});

test("ignores unknown billing reasons and invoices without a subscription", () => {
  expect(
    extractPaidSubscriptionInvoice(
      paidInvoiceEvent({
        billing_reason: "unknown_future_reason",
        subscription: "sub_unknown",
      }),
    ),
  ).toBeNull();
  expect(
    extractPaidSubscriptionInvoice(
      paidInvoiceEvent({ billing_reason: "manual" }),
    ),
  ).toBeNull();
});

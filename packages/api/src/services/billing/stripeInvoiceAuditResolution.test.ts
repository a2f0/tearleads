import { expect, spyOn, test } from "bun:test";
import type { StripeSubscriptionBinding } from "../../billing/stripeSubscriptionBinding";
import { extractPaidSubscriptionInvoice } from "../../billing/stripeWebhook";
import { resolveStripeInvoiceAuditInput } from "./stripeInvoiceAudit";

const BINDING: StripeSubscriptionBinding = {
  billingPeriodEndsAt: new Date("2026-08-01T00:00:00.000Z"),
  billingPeriodStartsAt: new Date("2026-07-01T00:00:00.000Z"),
  currency: "usd",
  customerId: "cus_1",
  interval: "month",
  intervalCount: 1,
  organizationId: "org-1",
  priceId: "price_sync",
  seatQuantity: 3,
  status: "active",
  subscriptionItemId: "si_1",
  unitAmount: 499,
  userId: "user-1",
};

function invoiceBody(input: {
  readonly hasMore: boolean;
  readonly price: Record<string, unknown>;
  readonly quantity?: number;
}) {
  return {
    id: "in_1",
    amount_paid: 1_497,
    billing_reason: "subscription_cycle",
    currency: "usd",
    status_transitions: { paid_at: 1_783_123_456 },
    subscription: "sub_1",
    lines: {
      has_more: input.hasMore,
      data: [
        {
          id: "il_1",
          currency: "usd",
          period: { start: 1_783_036_800, end: 1_785_715_200 },
          price: input.price,
          proration: false,
          quantity: input.quantity ?? 3,
          subscription: "sub_1",
          subscription_item: "si_1",
        },
      ],
    },
  };
}

function parseInvoice(body: ReturnType<typeof invoiceBody>) {
  const invoice = extractPaidSubscriptionInvoice({
    id: "evt_1",
    type: "invoice.paid",
    data: { object: body },
  });
  if (!invoice) {
    throw new Error("expected paid subscription invoice");
  }
  return invoice;
}

function respondingFetch(responses: unknown[], urls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(responses.shift() ?? {}));
  }) as typeof fetch;
}

test("a matching line from a truncated embed is replaced by the complete list", async () => {
  const body = invoiceBody({
    hasMore: true,
    price: {
      id: "price_sync",
      recurring: { interval: "month", interval_count: 3 },
      unit_amount: 499,
    },
  });
  const urls: string[] = [];

  const audit = await resolveStripeInvoiceAuditInput({
    binding: BINDING,
    invoice: parseInvoice(body),
    organizationId: "org-1",
    stripeDeps: {
      env: { STRIPE_SECRET_KEY: "sk_test_123" },
      fetchImpl: respondingFetch(
        [body, { data: body.lines.data, has_more: false }],
        urls,
      ),
    },
  });

  expect(urls).toEqual([
    "https://api.stripe.com/v1/invoices/in_1",
    "https://api.stripe.com/v1/invoices/in_1/lines?limit=100",
  ]);
  expect(audit).toMatchObject({
    interval: "month",
    intervalCount: 3,
    seatCount: 3,
    unitAmount: 499,
  });
});

test("missing historical cadence and rate stay stable across binding changes", async () => {
  const invoice = parseInvoice(
    invoiceBody({
      hasMore: false,
      price: { currency: "usd", id: "price_sync" },
    }),
  );
  const first = await resolveStripeInvoiceAuditInput({
    binding: BINDING,
    invoice,
    organizationId: "org-1",
    stripeDeps: {},
  });
  const replay = await resolveStripeInvoiceAuditInput({
    binding: {
      ...BINDING,
      interval: "year",
      intervalCount: 2,
      unitAmount: 999,
    },
    invoice,
    organizationId: "org-1",
    stripeDeps: {},
  });

  expect(first).toMatchObject({
    interval: null,
    intervalCount: null,
    unitAmount: null,
  });
  expect(replay).toEqual(first);
});

test("a rotated fixed Price keeps capacity from its historical economics", async () => {
  const audit = await resolveStripeInvoiceAuditInput({
    binding: { ...BINDING, priceId: "price_rotated_team_5", seatQuantity: 1 },
    invoice: parseInvoice(
      invoiceBody({
        hasMore: false,
        quantity: 1,
        price: {
          currency: "usd",
          id: "price_rotated_team_5",
          recurring: { interval: "month", interval_count: 1 },
          unit_amount: 1_000,
        },
      }),
    ),
    organizationId: "org-1",
    stripeDeps: {},
  });

  expect(audit).toMatchObject({
    priceId: "price_rotated_team_5",
    seatCount: 5,
    unitAmount: 1_000,
  });
});

test("legacy quantity does not masquerade as fixed-tier economics", async () => {
  const audit = await resolveStripeInvoiceAuditInput({
    binding: { ...BINDING, priceId: "price_legacy", seatQuantity: 3 },
    invoice: parseInvoice(
      invoiceBody({
        hasMore: false,
        price: {
          currency: "usd",
          id: "price_legacy",
          recurring: { interval: "month", interval_count: 1 },
          unit_amount: 1_000,
        },
        quantity: 3,
      }),
    ),
    organizationId: "org-1",
    stripeDeps: {},
  });

  expect(audit).toMatchObject({
    priceId: "price_legacy",
    seatCount: 3,
    unitAmount: 1_000,
  });
});

test("a complete invoice with invalid line attribution keeps its exact total", async () => {
  const body = invoiceBody({
    hasMore: false,
    price: {
      id: "price_sync",
      recurring: { interval: "month", interval_count: 1 },
      unit_amount: 499,
    },
  });
  const [line] = body.lines.data;
  if (!line) {
    throw new Error("expected invoice line");
  }
  line.currency = "eur";

  const audit = await resolveStripeInvoiceAuditInput({
    binding: BINDING,
    invoice: parseInvoice(body),
    organizationId: "org-1",
    stripeDeps: {},
  });

  expect(audit).toEqual({
    billingReason: "subscription_cycle",
    currency: "usd",
    interval: null,
    intervalCount: null,
    invoiceId: "in_1",
    occurredAt: new Date(1_783_123_456 * 1000),
    organizationId: "org-1",
    periodEndsAt: null,
    periodStartsAt: null,
    priceId: null,
    providerEventId: "evt_1",
    seatCount: null,
    subscriptionId: "sub_1",
    totalAmount: 1_497,
    unitAmount: null,
  });
});

test("pinned line details enrich a signed total without replacing it", async () => {
  const embeddedBody = invoiceBody({
    hasMore: false,
    price: { id: "price_sync" },
  });
  const [embeddedLine] = embeddedBody.lines.data;
  if (!embeddedLine) {
    throw new Error("expected embedded invoice line");
  }
  embeddedLine.currency = "eur";
  const fetchedBody = {
    ...invoiceBody({
      hasMore: false,
      price: {
        id: "price_sync",
        recurring: { interval: "month", interval_count: 3 },
        unit_amount: 499,
      },
    }),
    amount_paid: 9_999,
    status_transitions: {},
  };
  const urls: string[] = [];

  const audit = await resolveStripeInvoiceAuditInput({
    binding: BINDING,
    invoice: parseInvoice(embeddedBody),
    organizationId: "org-1",
    stripeDeps: {
      env: { STRIPE_SECRET_KEY: "sk_test_123" },
      fetchImpl: respondingFetch([fetchedBody], urls),
    },
  });

  expect(urls).toEqual(["https://api.stripe.com/v1/invoices/in_1"]);
  expect(audit).toMatchObject({
    interval: "month",
    intervalCount: 3,
    occurredAt: new Date(1_783_123_456 * 1000),
    providerEventId: "evt_1",
    seatCount: 3,
    totalAmount: 1_497,
    unitAmount: 499,
  });
});

test("optional pinned enrichment cannot block an exact total-only audit", async () => {
  const body = invoiceBody({
    hasMore: false,
    price: { id: "price_sync" },
  });
  const [line] = body.lines.data;
  if (!line) {
    throw new Error("expected invoice line");
  }
  line.currency = "eur";
  const warningSpy = spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const audit = await resolveStripeInvoiceAuditInput({
      binding: BINDING,
      invoice: parseInvoice(body),
      organizationId: "org-1",
      stripeDeps: {
        env: { STRIPE_SECRET_KEY: "sk_test_123" },
        fetchImpl: (async (_input: RequestInfo | URL) =>
          new Response("", { status: 503 })) as typeof fetch,
      },
    });

    expect(audit).toMatchObject({
      seatCount: null,
      totalAmount: 1_497,
      unitAmount: null,
    });
    expect(warningSpy).toHaveBeenCalledWith(
      "Stripe invoice detail enrichment failed; preserving the signed snapshot",
      { invoiceId: "in_1", status: 503 },
    );
  } finally {
    warningSpy.mockRestore();
  }
});

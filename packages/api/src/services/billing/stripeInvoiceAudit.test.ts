import { expect, spyOn, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { organizationBillingInvoiceEvents } from "@symcrypt/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  createWebhookBillingOrganization,
  paidInvoiceEvent,
  createRespondingFetch as respondingFetch,
  STRIPE_WEBHOOK_ENV as STRIPE_ENV,
  signedStripeWebhookDelivery as signedDelivery,
  stripeSubscriptionBody,
} from "../../../test/helpers/stripeWebhook";
import { getDefaultApiServiceRuntime } from "../runtime";
import { processStripeWebhook } from "./stripeCheckout";

async function findInvoiceRows(invoiceId: string) {
  return db
    .select()
    .from(organizationBillingInvoiceEvents)
    .where(eq(organizationBillingInvoiceEvents.invoiceId, invoiceId));
}

test("duplicate delivery records one exact financial snapshot", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const subscriptionItemId = `si_${organizationId}`;
  const invoiceId = `in_${organizationId}`;
  const periodStart = 1_783_036_800;
  const periodEnd = 1_785_715_200;
  const paidAt = 1_783_123_456;
  const totalAmount = 3_000_000_001;
  await createWebhookBillingOrganization(organizationId);
  const invoiceSubscription = stripeSubscriptionBody(
    3,
    periodStart,
    periodEnd,
    subscriptionId,
    subscriptionItemId,
    organizationId,
    { id: "price_historical", intervalCount: 3, unitAmount: 499 },
  );
  const event = paidInvoiceEvent({
    // Deliberately exceeds INT32 and differs from quantity * unit_amount. The
    // audit must preserve Stripe's exact charged total without recomputing it.
    amountPaid: totalAmount,
    billingReason: "subscription_cycle",
    invoiceId,
    paidAt,
    subscription: invoiceSubscription,
  });
  // The webhook was delayed until after the subscription moved to a new
  // quantity, price, and period. History must retain the invoice's line facts.
  const currentSubscription = stripeSubscriptionBody(
    7,
    periodEnd,
    periodEnd + 2_678_400,
    subscriptionId,
    subscriptionItemId,
    organizationId,
    { unitAmount: 999 },
  );
  const responses = [
    { body: currentSubscription },
    { body: currentSubscription },
  ];

  const first = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery(event),
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch(responses, []),
      },
    },
  );
  const second = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery(event),
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch(responses, []),
      },
    },
  );

  expect(first).toEqual({
    status: "reconciled",
    subscriptionId,
    organizationId,
  });
  expect(second).toEqual(first);
  const rows = await findInvoiceRows(invoiceId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    organizationId,
    providerEventId: `evt_${invoiceId}`,
    invoiceId,
    subscriptionId,
    billingReason: "subscription_cycle",
    seatCount: 3,
    priceId: "price_historical",
    unitAmount: 499,
    currency: "usd",
    interval: "month",
    intervalCount: 3,
    totalAmount,
    periodStartsAt: new Date(periodStart * 1000),
    periodEndsAt: new Date(periodEnd * 1000),
    occurredAt: new Date(paidAt * 1000),
  });
});

test("an incomplete delivery cannot freeze a partial snapshot", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const invoiceId = `in_${organizationId}`;
  const subscription = stripeSubscriptionBody(
    2,
    1_783_036_800,
    1_785_715_200,
    subscriptionId,
    `si_${organizationId}`,
    organizationId,
  );
  await createWebhookBillingOrganization(organizationId);
  const incompleteEvent = {
    id: `evt_${invoiceId}_partial`,
    type: "invoice.paid",
    data: {
      object: {
        id: invoiceId,
        billing_reason: "subscription_cycle",
        subscription: subscriptionId,
      },
    },
  };
  const urls: string[] = [];

  const incomplete = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery(incompleteEvent),
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch(
          [{ body: subscription }, { body: incompleteEvent.data.object }],
          urls,
        ),
      },
    },
  );

  expect(incomplete).toEqual({
    status: "retry",
    reason: "Paid invoice details are incomplete",
  });
  expect(urls.some((url) => url.includes(`/v1/invoices/${invoiceId}`))).toBe(
    true,
  );
  expect(await findInvoiceRows(invoiceId)).toHaveLength(0);

  const complete = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery(
      paidInvoiceEvent({
        amountPaid: 998,
        billingReason: "subscription_cycle",
        invoiceId,
        subscription,
      }),
    ),
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch([{ body: subscription }], []),
      },
    },
  );

  expect(complete.status).toBe("reconciled");
  expect(await findInvoiceRows(invoiceId)).toHaveLength(1);
});

test("a partial webhook is completed from the pinned invoice lookup", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const invoiceId = `in_${organizationId}`;
  const paidAt = 1_783_123_456;
  const subscription = stripeSubscriptionBody(
    3,
    1_783_036_800,
    1_785_715_200,
    subscriptionId,
    `si_${organizationId}`,
    organizationId,
  );
  const completeEvent = paidInvoiceEvent({
    amountPaid: 1_201,
    billingReason: "subscription_cycle",
    invoiceId,
    paidAt,
    subscription,
  });
  await createWebhookBillingOrganization(organizationId);

  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery({
      id: `evt_${invoiceId}_partial`,
      type: "invoice.paid",
      data: {
        object: {
          id: invoiceId,
          billing_reason: "subscription_cycle",
          subscription: subscriptionId,
        },
      },
    }),
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch(
          [{ body: subscription }, { body: completeEvent.data.object }],
          [],
        ),
      },
    },
  );

  expect(outcome.status).toBe("reconciled");
  const [row] = await findInvoiceRows(invoiceId);
  expect(row).toMatchObject({
    providerEventId: `evt_${invoiceId}_partial`,
    seatCount: 5,
    totalAmount: 1_201,
    occurredAt: new Date(paidAt * 1000),
  });
});

test("subscription updates are audited without resetting the seat period", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const invoiceId = `in_${organizationId}`;
  const subscription = stripeSubscriptionBody(
    4,
    1_783_036_800,
    1_785_715_200,
    subscriptionId,
    `si_${organizationId}`,
    organizationId,
  );
  await createWebhookBillingOrganization(organizationId);

  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery(
      paidInvoiceEvent({
        amountPaid: 615,
        billingReason: "subscription_update",
        invoiceId,
        subscription,
      }),
    ),
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch([{ body: subscription }], []),
      },
    },
  );

  expect(outcome).toEqual({
    status: "ignored",
    reason: "Paid invoice requires no seat-period reconciliation",
  });
  const rows = await findInvoiceRows(invoiceId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    billingReason: "subscription_update",
    seatCount: 5,
    totalAmount: 615,
  });
});

test("proration-only updates are audited without incomplete retries", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const invoiceId = `in_${organizationId}`;
  const subscription = stripeSubscriptionBody(
    4,
    1_783_036_800,
    1_785_715_200,
    subscriptionId,
    `si_${organizationId}`,
    organizationId,
  );
  await createWebhookBillingOrganization(organizationId);
  const event = {
    id: `evt_${invoiceId}`,
    type: "invoice.paid",
    created: 1_783_123_456,
    data: {
      object: {
        id: invoiceId,
        amount_paid: 317,
        billing_reason: "subscription_update",
        currency: "usd",
        status_transitions: { paid_at: 1_783_123_456 },
        subscription: subscriptionId,
        lines: {
          has_more: false,
          data: [
            {
              id: `il_${invoiceId}`,
              currency: "usd",
              parent: {
                invoice_item_details: {
                  proration: true,
                  subscription: subscriptionId,
                },
              },
            },
          ],
        },
      },
    },
  };

  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery(event),
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch([{ body: subscription }], []),
      },
    },
  );

  expect(outcome).toEqual({
    status: "ignored",
    reason: "Paid invoice requires no seat-period reconciliation",
  });
  const [row] = await findInvoiceRows(invoiceId);
  expect(row).toMatchObject({
    billingReason: "subscription_update",
    totalAmount: 317,
    seatCount: null,
    priceId: null,
    periodStartsAt: null,
    periodEndsAt: null,
  });
});

test("conflicting redelivery leaves the first immutable snapshot", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const invoiceId = `in_${organizationId}`;
  const subscription = stripeSubscriptionBody(
    2,
    1_783_036_800,
    1_785_715_200,
    subscriptionId,
    `si_${organizationId}`,
    organizationId,
  );
  await createWebhookBillingOrganization(organizationId);
  const firstEvent = paidInvoiceEvent({
    amountPaid: 998,
    billingReason: "subscription_update",
    invoiceId,
    subscription,
  });
  const conflictingEvent = paidInvoiceEvent({
    amountPaid: 999,
    billingReason: "subscription_update",
    invoiceId,
    subscription,
  });
  const responses = [{ body: subscription }, { body: subscription }];

  expect(
    await processStripeWebhook(
      getDefaultApiServiceRuntime(),
      signedDelivery(firstEvent),
      {
        stripe: {
          env: STRIPE_ENV,
          fetchImpl: respondingFetch(responses, []),
        },
      },
    ),
  ).toEqual({
    status: "ignored",
    reason: "Paid invoice requires no seat-period reconciliation",
  });
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(
      await processStripeWebhook(
        getDefaultApiServiceRuntime(),
        signedDelivery(conflictingEvent),
        {
          stripe: {
            env: STRIPE_ENV,
            fetchImpl: respondingFetch(responses, []),
          },
        },
      ),
    ).toEqual({
      status: "ignored",
      reason: "Conflicting paid invoice snapshot",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Conflicting Stripe invoice audit snapshot; preserving the first snapshot",
      {
        invoiceId,
        organizationId,
        providerEventId: `evt_${invoiceId}`,
      },
    );
  } finally {
    errorSpy.mockRestore();
  }

  const rows = await findInvoiceRows(invoiceId);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.totalAmount).toBe(998);
});

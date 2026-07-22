import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBillingInvoiceEvents } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  createRespondingFetch,
  createWebhookBillingOrganization,
  paidInvoiceEvent,
  STRIPE_WEBHOOK_ENV,
  signedStripeWebhookDelivery,
  stripeSubscriptionBody,
} from "../../../test/helpers/stripeWebhook";
import { getDefaultApiServiceRuntime } from "../runtime";
import { processStripeWebhook } from "./stripeCheckout";

function recoverableUpdateFixture() {
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
  const completeEvent = paidInvoiceEvent({
    amountPaid: 842,
    billingReason: "subscription_update",
    invoiceId,
    subscription,
  });
  const partialEvent = {
    id: `evt_${invoiceId}_partial`,
    type: "invoice.paid",
    created: 1_783_123_456,
    data: {
      object: {
        id: invoiceId,
        billing_reason: "subscription_update",
        subscription: subscriptionId,
      },
    },
  };
  return {
    completeEvent,
    invoiceId,
    organizationId,
    partialEvent,
    subscription,
    subscriptionId,
  };
}

test("an incomplete non-seat invoice is acknowledged without provider retries", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const subscription = stripeSubscriptionBody(
    2,
    1_783_036_800,
    1_785_715_200,
    subscriptionId,
    `si_${organizationId}`,
    organizationId,
  );
  const event = {
    id: `evt_${organizationId}`,
    type: "invoice.paid",
    created: 1_783_123_456,
    data: {
      object: {
        billing_reason: "subscription_update",
        subscription: subscriptionId,
      },
    },
  };
  await createWebhookBillingOrganization(organizationId);
  const urls: string[] = [];
  const warningSpy = spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const outcome = await processStripeWebhook(
      getDefaultApiServiceRuntime(),
      signedStripeWebhookDelivery(event),
      {
        stripe: {
          env: STRIPE_WEBHOOK_ENV,
          fetchImpl: createRespondingFetch([{ body: subscription }], urls),
        },
      },
    );

    expect(outcome).toEqual({
      status: "ignored",
      reason: "Paid invoice audit details unavailable",
    });
    expect(urls).toEqual([
      `GET https://api.stripe.com/v1/subscriptions/${subscriptionId}`,
    ]);
    expect(warningSpy).toHaveBeenCalledWith(
      "Paid invoice audit details are unavailable",
      {
        invoiceId: null,
        organizationId,
        providerEventId: `evt_${organizationId}`,
      },
    );
  } finally {
    warningSpy.mockRestore();
  }
  const rows = await db
    .select()
    .from(organizationBillingInvoiceEvents)
    .where(eq(organizationBillingInvoiceEvents.organizationId, organizationId));
  expect(rows).toHaveLength(0);
});

test("a truncated non-seat invoice records its exact total without pagination", async () => {
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
  const event = paidInvoiceEvent({
    amountPaid: 317,
    billingReason: "subscription_update",
    invoiceId,
    subscription,
  });
  event.data.object.lines.has_more = true;
  await createWebhookBillingOrganization(organizationId);
  const urls: string[] = [];

  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedStripeWebhookDelivery(event),
    {
      stripe: {
        env: STRIPE_WEBHOOK_ENV,
        fetchImpl: createRespondingFetch([{ body: subscription }], urls),
      },
    },
  );

  expect(outcome).toEqual({
    status: "ignored",
    reason: "Paid invoice requires no seat-period reconciliation",
  });
  expect(urls).toEqual([
    `GET https://api.stripe.com/v1/subscriptions/${subscriptionId}`,
  ]);
  const [row] = await db
    .select()
    .from(organizationBillingInvoiceEvents)
    .where(eq(organizationBillingInvoiceEvents.invoiceId, invoiceId));
  expect(row).toMatchObject({
    seatCount: null,
    totalAmount: 317,
    unitAmount: null,
  });
});

test("a recoverable non-seat invoice is completed from the pinned lookup", async () => {
  const fixture = recoverableUpdateFixture();
  await createWebhookBillingOrganization(fixture.organizationId);
  const urls: string[] = [];

  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedStripeWebhookDelivery(fixture.partialEvent),
    {
      stripe: {
        env: STRIPE_WEBHOOK_ENV,
        fetchImpl: createRespondingFetch(
          [
            { body: fixture.subscription },
            { body: fixture.completeEvent.data.object },
          ],
          urls,
        ),
      },
    },
  );

  expect(outcome).toEqual({
    status: "ignored",
    reason: "Paid invoice requires no seat-period reconciliation",
  });
  expect(urls).toEqual([
    `GET https://api.stripe.com/v1/subscriptions/${fixture.subscriptionId}`,
    `GET https://api.stripe.com/v1/invoices/${fixture.invoiceId}`,
  ]);
  const [row] = await db
    .select()
    .from(organizationBillingInvoiceEvents)
    .where(eq(organizationBillingInvoiceEvents.invoiceId, fixture.invoiceId));
  expect(row).toMatchObject({
    providerEventId: `evt_${fixture.invoiceId}_partial`,
    seatCount: 2,
    totalAmount: 842,
    unitAmount: 499,
  });
});

test("a missing non-seat invoice is acknowledged after its pinned 404", async () => {
  const fixture = recoverableUpdateFixture();
  await createWebhookBillingOrganization(fixture.organizationId);
  const warningSpy = spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const outcome = await processStripeWebhook(
      getDefaultApiServiceRuntime(),
      signedStripeWebhookDelivery(fixture.partialEvent),
      {
        stripe: {
          env: STRIPE_WEBHOOK_ENV,
          fetchImpl: createRespondingFetch(
            [{ body: fixture.subscription }, { body: {}, status: 404 }],
            [],
          ),
        },
      },
    );

    expect(outcome).toEqual({
      status: "ignored",
      reason: "Paid invoice audit details unavailable",
    });
    expect(warningSpy).toHaveBeenCalledTimes(1);
  } finally {
    warningSpy.mockRestore();
  }
  const rows = await db
    .select()
    .from(organizationBillingInvoiceEvents)
    .where(
      eq(
        organizationBillingInvoiceEvents.organizationId,
        fixture.organizationId,
      ),
    );
  expect(rows).toHaveLength(0);
});

test("a transient non-seat invoice lookup still asks Stripe to redeliver", async () => {
  const fixture = recoverableUpdateFixture();
  await createWebhookBillingOrganization(fixture.organizationId);

  await expect(
    processStripeWebhook(
      getDefaultApiServiceRuntime(),
      signedStripeWebhookDelivery(fixture.partialEvent),
      {
        stripe: {
          env: STRIPE_WEBHOOK_ENV,
          fetchImpl: createRespondingFetch(
            [{ body: fixture.subscription }, { body: {}, status: 500 }],
            [],
          ),
        },
      },
    ),
  ).rejects.toThrow("Stripe invoice lookup failed with status 500");

  const rows = await db
    .select()
    .from(organizationBillingInvoiceEvents)
    .where(
      eq(
        organizationBillingInvoiceEvents.organizationId,
        fixture.organizationId,
      ),
    );
  expect(rows).toHaveLength(0);
});

test("a renewal without an invoice id is terminally acknowledged", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const subscription = stripeSubscriptionBody(
    2,
    1_783_036_800,
    1_785_715_200,
    subscriptionId,
    `si_${organizationId}`,
    organizationId,
  );
  const event = paidInvoiceEvent({
    billingReason: "subscription_cycle",
    invoiceId: `in_${organizationId}`,
    subscription,
  });
  Reflect.deleteProperty(event.data.object, "id");
  await createWebhookBillingOrganization(organizationId);

  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedStripeWebhookDelivery(event),
    {
      stripe: {
        env: STRIPE_WEBHOOK_ENV,
        fetchImpl: createRespondingFetch([{ body: subscription }], []),
      },
    },
  );

  expect(outcome).toEqual({
    status: "ignored",
    reason: "Renewal invoice carries no id",
  });
  const rows = await db
    .select()
    .from(organizationBillingInvoiceEvents)
    .where(eq(organizationBillingInvoiceEvents.organizationId, organizationId));
  expect(rows).toHaveLength(0);
});

import { expect, spyOn, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationBillingInvoiceEvents,
  organizationBillingStripeSeats,
} from "@symcrypt/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  createRespondingFetch,
  createWebhookBillingOrganization,
  paidInvoiceEvent,
  REVENUECAT_WEBHOOK_ENV,
  STRIPE_WEBHOOK_ENV,
  signedStripeWebhookDelivery,
  stripeSubscriptionBody,
} from "../../../test/helpers/stripeWebhook";
import { getDefaultApiServiceRuntime } from "../runtime";
import { processStripeWebhook } from "./stripeCheckout";

test("an ambiguous cycle records its total and still reconciles paid seats", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const invoiceId = `in_${organizationId}`;
  const subscription = stripeSubscriptionBody(
    3,
    1_783_036_800,
    1_785_715_200,
    subscriptionId,
    `si_${organizationId}`,
    organizationId,
  );
  const event = paidInvoiceEvent({
    amountPaid: 1_201,
    billingReason: "subscription_cycle",
    invoiceId,
    subscription,
  });
  const [seatLine] = event.data.object.lines.data;
  if (!seatLine) {
    throw new Error("expected invoice seat line");
  }
  event.data.object.lines.data = [
    {
      ...seatLine,
      price: { ...seatLine.price, id: "price_other_1" },
      subscription_item: "si_other_1",
    },
    {
      ...seatLine,
      price: { ...seatLine.price, id: "price_other_2" },
      subscription_item: "si_other_2",
    },
  ];
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
    status: "reconciled",
    subscriptionId,
    organizationId,
  });
  const [invoiceRow] = await db
    .select()
    .from(organizationBillingInvoiceEvents)
    .where(eq(organizationBillingInvoiceEvents.invoiceId, invoiceId));
  expect(invoiceRow).toMatchObject({
    totalAmount: 1_201,
    seatCount: null,
    priceId: null,
    unitAmount: null,
    periodStartsAt: null,
    periodEndsAt: null,
  });
  const [seatState] = await db
    .select({
      appliedPaidCapacity: organizationBillingStripeSeats.appliedPaidCapacity,
      lastInvoiceId: organizationBillingStripeSeats.lastInvoiceId,
    })
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(seatState).toMatchObject({
    appliedPaidCapacity: 5,
    lastInvoiceId: invoiceId,
  });
});

test("an unresolvable cycle line list falls back to its exact total", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const invoiceId = `in_${organizationId}`;
  const subscription = stripeSubscriptionBody(
    3,
    1_783_036_800,
    1_785_715_200,
    subscriptionId,
    `si_${organizationId}`,
    organizationId,
  );
  const event = paidInvoiceEvent({
    amountPaid: 1_201,
    billingReason: "subscription_cycle",
    invoiceId,
    subscription,
  });
  event.data.object.lines.has_more = true;
  const repeatedPage = {
    data: [{ id: `il_${organizationId}_repeat` }],
    has_more: true,
  };
  await createWebhookBillingOrganization(organizationId);
  const urls: string[] = [];

  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedStripeWebhookDelivery(event),
    {
      stripe: {
        env: STRIPE_WEBHOOK_ENV,
        fetchImpl: createRespondingFetch(
          [
            { body: subscription },
            { body: event.data.object },
            { body: repeatedPage },
            { body: repeatedPage },
          ],
          urls,
        ),
      },
    },
  );

  expect(outcome).toEqual({
    status: "reconciled",
    subscriptionId,
    organizationId,
  });
  expect(urls).toHaveLength(4);
  const [invoiceRow] = await db
    .select()
    .from(organizationBillingInvoiceEvents)
    .where(eq(organizationBillingInvoiceEvents.invoiceId, invoiceId));
  expect(invoiceRow).toMatchObject({
    seatCount: null,
    totalAmount: 1_201,
    unitAmount: null,
  });
  const [seatState] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(seatState).toMatchObject({
    appliedPaidCapacity: 5,
    lastInvoiceId: invoiceId,
  });
});

test("an initial purchase without an invoice id still fulfills", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const subscriptionItemId = `si_${organizationId}`;
  const subscription = stripeSubscriptionBody(
    2,
    1_783_036_800,
    1_785_715_200,
    subscriptionId,
    subscriptionItemId,
    organizationId,
  );
  const event = paidInvoiceEvent({
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
      revenueCat: {
        env: REVENUECAT_WEBHOOK_ENV,
        fetchImpl: createRespondingFetch(
          [{ body: {} }, { body: {} }, { body: {} }],
          [],
        ),
      },
    },
  );

  expect(outcome).toEqual({
    status: "associated",
    subscriptionId,
    organizationId,
  });
  const rows = await db
    .select()
    .from(organizationBillingInvoiceEvents)
    .where(eq(organizationBillingInvoiceEvents.organizationId, organizationId));
  expect(rows).toHaveLength(0);
  const [seatState] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(seatState).toMatchObject({
    appliedPaidCapacity: 5,
    subscriptionItemId,
  });
});

test("a mismatched purchase fails closed before unresolved line pagination", async () => {
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
  const event = paidInvoiceEvent({ invoiceId, subscription });
  event.data.object.lines.has_more = true;
  const mismatchedInvoice = {
    ...event.data.object,
    lines: { ...event.data.object.lines, has_more: true },
    subscription: `sub_${organizationId}_other`,
  };
  await createWebhookBillingOrganization(organizationId);
  const revenueCatUrls: string[] = [];
  const stripeUrls: string[] = [];

  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedStripeWebhookDelivery(event),
    {
      stripe: {
        env: STRIPE_WEBHOOK_ENV,
        fetchImpl: createRespondingFetch(
          [{ body: subscription }, { body: mismatchedInvoice }],
          stripeUrls,
        ),
      },
      revenueCat: {
        env: REVENUECAT_WEBHOOK_ENV,
        fetchImpl: createRespondingFetch([], revenueCatUrls),
      },
    },
  );

  expect(outcome).toEqual({
    status: "retry",
    reason: "Paid invoice details are incomplete",
  });
  expect(stripeUrls).toHaveLength(2);
  expect(revenueCatUrls).toHaveLength(0);
  const invoiceRows = await db
    .select()
    .from(organizationBillingInvoiceEvents)
    .where(eq(organizationBillingInvoiceEvents.organizationId, organizationId));
  expect(invoiceRows).toHaveLength(0);
  const seatRows = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(seatRows).toHaveLength(0);
});

test("a compatible audit redelivery completes association after a partial failure", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const invoiceId = `in_${organizationId}`;
  const firstItemId = `si_${organizationId}_first`;
  const matchedItemId = `si_${organizationId}_matched`;
  const firstSubscription = stripeSubscriptionBody(
    3,
    1_783_036_800,
    1_785_715_200,
    subscriptionId,
    firstItemId,
    organizationId,
  );
  const matchedSubscription = stripeSubscriptionBody(
    3,
    1_783_036_800,
    1_785_715_200,
    subscriptionId,
    matchedItemId,
    organizationId,
  );
  const event = paidInvoiceEvent({
    amountPaid: 1_497,
    billingReason: "subscription_create",
    invoiceId,
    subscription: firstSubscription,
  });
  const [templateLine] = event.data.object.lines.data;
  if (!templateLine) {
    throw new Error("expected invoice line");
  }
  event.data.object.lines.data = [
    { ...templateLine, subscription_item: matchedItemId },
    { ...templateLine, subscription_item: `si_${organizationId}_other` },
  ];
  await createWebhookBillingOrganization(organizationId);

  await expect(
    processStripeWebhook(
      getDefaultApiServiceRuntime(),
      signedStripeWebhookDelivery(event),
      {
        stripe: {
          env: STRIPE_WEBHOOK_ENV,
          fetchImpl: createRespondingFetch(
            [{ body: firstSubscription }, { body: event.data.object }],
            [],
          ),
        },
        revenueCat: {
          env: REVENUECAT_WEBHOOK_ENV,
          fetchImpl: createRespondingFetch([{ body: {}, status: 500 }], []),
        },
      },
    ),
  ).rejects.toThrow("RevenueCat customer create failed with status 500");

  const warningSpy = spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const outcome = await processStripeWebhook(
      getDefaultApiServiceRuntime(),
      signedStripeWebhookDelivery(event),
      {
        stripe: {
          env: STRIPE_WEBHOOK_ENV,
          fetchImpl: createRespondingFetch([{ body: matchedSubscription }], []),
        },
        revenueCat: {
          env: REVENUECAT_WEBHOOK_ENV,
          fetchImpl: createRespondingFetch(
            [{ body: {} }, { body: {} }, { body: {} }],
            [],
          ),
        },
      },
    );

    expect(outcome).toEqual({
      status: "associated",
      subscriptionId,
      organizationId,
    });
    expect(warningSpy).toHaveBeenCalledWith(
      "Compatible Stripe invoice audit redelivery differs; preserving the first snapshot and continuing fulfillment",
      {
        invoiceId,
        organizationId,
        providerEventId: `evt_${invoiceId}`,
      },
    );
  } finally {
    warningSpy.mockRestore();
  }

  const [invoiceRow] = await db
    .select()
    .from(organizationBillingInvoiceEvents)
    .where(eq(organizationBillingInvoiceEvents.invoiceId, invoiceId));
  expect(invoiceRow).toMatchObject({
    seatCount: null,
    totalAmount: 1_497,
    unitAmount: null,
  });
  const [seatState] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(seatState).toMatchObject({
    appliedPaidCapacity: 5,
    subscriptionItemId: matchedItemId,
  });
});

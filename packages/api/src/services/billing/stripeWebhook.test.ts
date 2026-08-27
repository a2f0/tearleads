import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { organizationBillingStripeSeats } from "@symcrypt/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  createWebhookBillingOrganization,
  STRIPE_WEBHOOK_ORGANIZATION_ID as ORG_ID,
  paidInvoiceEvent,
  REVENUECAT_WEBHOOK_ENV as REVENUECAT_ENV,
  createRespondingFetch as respondingFetch,
  STRIPE_WEBHOOK_ENV as STRIPE_ENV,
  signedStripeWebhookDelivery as signedDelivery,
  stripeSubscriptionBody,
} from "../../../test/helpers/stripeWebhook";
import { getDefaultApiServiceRuntime } from "../runtime";
import { processStripeWebhook } from "./stripeCheckout";

const PAID_EVENT = paidInvoiceEvent({
  invoiceId: "in_first",
  subscription: stripeSubscriptionBody(),
});

test("a paid first invoice is associated with RevenueCat", async () => {
  await createWebhookBillingOrganization();
  const urls: string[] = [];
  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery(PAID_EVENT),
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch(
          [
            {
              body: stripeSubscriptionBody(),
            },
          ],
          urls,
        ),
      },
      revenueCat: {
        env: REVENUECAT_ENV,
        fetchImpl: respondingFetch(
          [{ body: {} }, { body: {} }, { body: {} }],
          urls,
        ),
      },
    },
  );

  expect(outcome).toEqual({
    status: "associated",
    subscriptionId: "sub_1",
    organizationId: ORG_ID,
  });
  // The customer must exist before v2 attributes accepts a write, and the
  // receipt (v1, Stripe app key) closes the association.
  expect(urls).toEqual([
    "GET https://api.stripe.com/v1/subscriptions/sub_1?expand[]=customer&expand[]=default_payment_method",
    "POST https://api.revenuecat.com/v2/projects/proj_1/customers",
    "POST https://api.revenuecat.com/v2/projects/proj_1/customers/user-1/attributes",
    "POST https://api.revenuecat.com/v1/receipts",
  ]);
  const [stripeSeats] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, ORG_ID));
  expect(stripeSeats).toMatchObject({
    appliedPaidCapacity: 5,
    desiredRenewalQuantity: 5,
    subscriptionId: "sub_1",
    subscriptionItemId: "si_1",
  });
});

test("a new subscription promotes its card email to the Customer", async () => {
  await createWebhookBillingOrganization();
  const urls: string[] = [];
  const subscription = {
    ...stripeSubscriptionBody(),
    customer: { id: "cus_1", email: "" },
    default_payment_method: {
      billing_details: { email: "buyer@example.com" },
    },
  };
  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery(paidInvoiceEvent({ invoiceId: "in_email", subscription })),
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch(
          [{ body: subscription }, { body: { id: "cus_1" } }],
          urls,
        ),
      },
      revenueCat: {
        env: REVENUECAT_ENV,
        fetchImpl: respondingFetch(
          [{ body: {} }, { body: {} }, { body: {} }],
          urls,
        ),
      },
    },
  );

  expect(outcome.status).toBe("associated");
  expect(urls[1]).toBe("POST https://api.stripe.com/v1/customers/cus_1");
});

test("a new subscription without a recovery email asks for redelivery", async () => {
  const subscription = {
    ...stripeSubscriptionBody(),
    customer: { id: "cus_1", email: "" },
  };
  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery(
      paidInvoiceEvent({ invoiceId: "in_no_email", subscription }),
    ),
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch([{ body: subscription }], []),
      },
    },
  );

  expect(outcome).toEqual({
    status: "retry",
    reason: "Subscription carries no billing email",
  });
});

test("renewal invoices reset the Stripe paid-capacity baseline", async () => {
  await createWebhookBillingOrganization();
  const subscription = stripeSubscriptionBody(1, 1_785_715_200, 1_788_393_600);
  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery(
      paidInvoiceEvent({
        billingReason: "subscription_cycle",
        invoiceId: "in_renewal",
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
    status: "reconciled",
    subscriptionId: "sub_1",
    organizationId: ORG_ID,
  });
  const [stripeSeats] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, ORG_ID));
  expect(stripeSeats?.appliedPaidCapacity).toBe(1);
  expect(stripeSeats?.lastInvoiceId).toBe("in_renewal");
});

test("a delayed predecessor cannot replace or associate after its successor", async () => {
  const organizationId = crypto.randomUUID();
  await createWebhookBillingOrganization(organizationId);
  const urls: string[] = [];
  async function deliver(
    billingReason:
      | "subscription_create"
      | "subscription_cycle"
      | "subscription_update",
    invoiceId: string,
    subscriptionBody: ReturnType<typeof stripeSubscriptionBody>,
  ) {
    return processStripeWebhook(
      getDefaultApiServiceRuntime(),
      signedDelivery(
        paidInvoiceEvent({
          billingReason,
          invoiceId,
          subscription: subscriptionBody,
        }),
      ),
      {
        stripe: {
          env: STRIPE_ENV,
          fetchImpl: respondingFetch([{ body: subscriptionBody }], urls),
        },
        revenueCat: {
          env: REVENUECAT_ENV,
          fetchImpl: respondingFetch(
            [{ body: {} }, { body: {} }, { body: {} }],
            urls,
          ),
        },
      },
    );
  }

  const subscriptionIdA = `sub_${organizationId}_a`;
  const subscriptionItemIdA = `si_${organizationId}_a`;
  const subscriptionIdB = `sub_${organizationId}_b`;
  const subscriptionItemIdB = `si_${organizationId}_b`;
  const subscriptionIdC = `sub_${organizationId}_c`;
  const subscriptionItemIdC = `si_${organizationId}_c`;
  const subscriptionA = stripeSubscriptionBody(
    2,
    1_783_036_800,
    1_785_715_200,
    subscriptionIdA,
    subscriptionItemIdA,
    organizationId,
  );
  const subscriptionB = stripeSubscriptionBody(
    2,
    1_785_715_200,
    1_788_393_600,
    subscriptionIdB,
    subscriptionItemIdB,
    organizationId,
  );
  const subscriptionC = stripeSubscriptionBody(
    2,
    1_785_715_200,
    1_788_393_600,
    subscriptionIdC,
    subscriptionItemIdC,
    organizationId,
  );
  expect(
    await deliver(
      "subscription_create",
      `in_${organizationId}_a_create`,
      subscriptionA,
    ),
  ).toEqual({
    status: "associated",
    subscriptionId: subscriptionIdA,
    organizationId,
  });
  expect(
    await deliver(
      "subscription_create",
      `in_${organizationId}_b_create`,
      subscriptionB,
    ),
  ).toEqual({
    status: "associated",
    subscriptionId: subscriptionIdB,
    organizationId,
  });
  expect(await deliver("subscription_cycle", "in_b", subscriptionB)).toEqual({
    status: "reconciled",
    subscriptionId: subscriptionIdB,
    organizationId,
  });

  expect(
    await deliver(
      "subscription_create",
      `in_${organizationId}_c_create`,
      subscriptionC,
    ),
  ).toEqual({
    status: "retry",
    reason: "Stripe subscription ordering is ambiguous",
  });
  const revenueCatCallsBeforeStale = urls.filter((url) =>
    url.includes("api.revenuecat.com"),
  ).length;

  const staleInitial = await deliver(
    "subscription_create",
    `in_${organizationId}_a_stale_create`,
    subscriptionA,
  );
  const staleRenewal = await deliver(
    "subscription_cycle",
    "in_stale_a",
    subscriptionA,
  );
  expect(staleInitial).toEqual({
    status: "ignored",
    reason: "Stale Stripe subscription invoice",
  });
  expect(staleRenewal).toEqual({
    status: "ignored",
    reason: "Stale Stripe subscription invoice",
  });

  const [stripeSeats] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(stripeSeats).toMatchObject({
    lastInvoiceId: "in_b",
    subscriptionId: subscriptionIdB,
    subscriptionItemId: subscriptionItemIdB,
  });
  expect(revenueCatCallsBeforeStale).toBe(6);
  expect(urls.filter((url) => url.includes("api.revenuecat.com"))).toHaveLength(
    revenueCatCallsBeforeStale,
  );
});

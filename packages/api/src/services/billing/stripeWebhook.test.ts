import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  organizations,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { getDefaultApiServiceRuntime } from "../runtime";
import { processStripeWebhook } from "./stripeCheckout";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const WEBHOOK_SECRET = "whsec_test";
const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_SYNC_PRICE_ID: "price_sync",
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
};
const REVENUECAT_ENV = {
  REVENUECAT_V2_SECRET_KEY: "sk_rc",
  REVENUECAT_PROJECT_ID: "proj_1",
  REVENUECAT_STRIPE_PUBLIC_API_KEY: "strp_pub",
};

async function createWebhookBillingOrganization(): Promise<void> {
  await db
    .insert(organizations)
    .values({
      id: ORG_ID,
      adminGroupId: "22222222-2222-4222-8222-222222222222",
      memberGroupId: "33333333-3333-4333-8333-333333333333",
      name: "Webhook organization",
    })
    .onConflictDoNothing();
  await db
    .insert(organizationBilling)
    .values({
      organizationId: ORG_ID,
      seatCount: 2,
      status: "trialing",
      trialEndsAt: new Date("2026-08-01T00:00:00.000Z"),
    })
    .onConflictDoNothing();
}

function stripeSubscriptionBody(
  quantity = 2,
  periodStart = 1_783_036_800,
  periodEnd = 1_785_715_200,
) {
  return {
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    current_period_start: periodStart,
    current_period_end: periodEnd,
    metadata: { userId: "user-1", orgId: ORG_ID },
    items: {
      data: [
        {
          id: "si_1",
          quantity,
          price: { id: "price_sync" },
        },
      ],
    },
  };
}

function signedDelivery(event: unknown): {
  payload: string;
  signatureHeader: string;
} {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return { payload, signatureHeader: `t=${timestamp},v1=${signature}` };
}

function respondingFetch(
  responses: Array<{ status?: number; body: unknown }>,
  urls: string[],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(`${init?.method ?? "GET"} ${String(input)}`);
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
    });
  }) as typeof fetch;
}

const PAID_EVENT = {
  type: "invoice.paid",
  data: {
    object: { billing_reason: "subscription_create", subscription: "sub_1" },
  },
};

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
    "GET https://api.stripe.com/v1/subscriptions/sub_1",
    "POST https://api.revenuecat.com/v2/projects/proj_1/customers",
    "POST https://api.revenuecat.com/v2/projects/proj_1/customers/user-1/attributes",
    "POST https://api.revenuecat.com/v1/receipts",
  ]);
  const [stripeSeats] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, ORG_ID));
  expect(stripeSeats).toMatchObject({
    appliedPaidCapacity: 2,
    desiredRenewalQuantity: 2,
    subscriptionId: "sub_1",
    subscriptionItemId: "si_1",
  });
});

test("renewal invoices reset the Stripe paid-capacity baseline", async () => {
  await createWebhookBillingOrganization();
  const outcome = await processStripeWebhook(
    getDefaultApiServiceRuntime(),
    signedDelivery({
      type: "invoice.paid",
      data: {
        object: {
          id: "in_renewal",
          billing_reason: "subscription_cycle",
          subscription: "sub_1",
        },
      },
    }),
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch(
          [{ body: stripeSubscriptionBody(1, 1_785_715_200, 1_788_393_600) }],
          [],
        ),
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

import { createHmac } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizations,
} from "@tearleads/api-shared/schema";

export const STRIPE_WEBHOOK_ORGANIZATION_ID =
  "11111111-1111-4111-8111-111111111111";

const STRIPE_WEBHOOK_SECRET = "whsec_test";

export const STRIPE_WEBHOOK_ENV = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
  STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
  STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
  STRIPE_WEBHOOK_SECRET,
};

export const REVENUECAT_WEBHOOK_ENV = {
  REVENUECAT_V2_SECRET_KEY: "sk_rc",
  REVENUECAT_PROJECT_ID: "proj_1",
  REVENUECAT_STRIPE_PUBLIC_API_KEY: "strp_pub",
};

export async function createWebhookBillingOrganization(
  organizationId: string = STRIPE_WEBHOOK_ORGANIZATION_ID,
): Promise<void> {
  await db
    .insert(organizations)
    .values({
      id: organizationId,
      adminGroupId: "22222222-2222-4222-8222-222222222222",
      memberGroupId: "33333333-3333-4333-8333-333333333333",
      name: "Webhook organization",
    })
    .onConflictDoNothing();
  await db
    .insert(organizationBilling)
    .values({
      organizationId,
      seatCount: 2,
      status: "trialing",
      trialEndsAt: new Date("2026-08-01T00:00:00.000Z"),
    })
    .onConflictDoNothing();
}

export function stripeSubscriptionBody(
  quantity = 2,
  periodStart = 1_783_036_800,
  periodEnd = 1_785_715_200,
  subscriptionId = "sub_1",
  subscriptionItemId = "si_1",
  organizationId = STRIPE_WEBHOOK_ORGANIZATION_ID,
  price: {
    currency?: string;
    id?: string;
    interval?: string;
    intervalCount?: number;
    unitAmount?: number;
  } = {},
) {
  const tierPriceId =
    quantity <= 1
      ? "price_sync"
      : quantity <= 5
        ? "price_team_5"
        : "price_team_10";
  return {
    id: subscriptionId,
    status: "active",
    customer: { id: "cus_1", email: "buyer@example.com" },
    current_period_start: periodStart,
    current_period_end: periodEnd,
    metadata: { userId: "user-1", orgId: organizationId },
    items: {
      data: [
        {
          id: subscriptionItemId,
          quantity,
          price: {
            id: price.id ?? tierPriceId,
            currency: price.currency ?? "usd",
            recurring: {
              interval: price.interval ?? "month",
              interval_count: price.intervalCount ?? 1,
            },
            unit_amount: price.unitAmount ?? 499,
          },
        },
      ],
    },
  };
}

export function paidInvoiceEvent(input: {
  amountPaid?: number;
  billingReason?:
    | "subscription_create"
    | "subscription_cycle"
    | "subscription_update";
  invoiceId: string;
  paidAt?: number;
  subscription: ReturnType<typeof stripeSubscriptionBody>;
}) {
  const [item] = input.subscription.items.data;
  if (!item) {
    throw new Error("expected subscription item");
  }
  const paidAt = input.paidAt ?? input.subscription.current_period_start;
  return {
    id: `evt_${input.invoiceId}`,
    type: "invoice.paid",
    created: paidAt,
    data: {
      object: {
        id: input.invoiceId,
        amount_paid: input.amountPaid ?? item.quantity * item.price.unit_amount,
        billing_reason: input.billingReason ?? "subscription_create",
        currency: item.price.currency,
        status_transitions: { paid_at: paidAt },
        subscription: input.subscription.id,
        lines: {
          has_more: false,
          data: [
            {
              currency: item.price.currency,
              period: {
                start: input.subscription.current_period_start,
                end: input.subscription.current_period_end,
              },
              price: item.price,
              proration: false,
              quantity: item.quantity,
              subscription: input.subscription.id,
              subscription_item: item.id,
              type: "subscription",
            },
          ],
        },
      },
    },
  };
}

export function signedStripeWebhookDelivery(event: unknown): {
  payload: string;
  signatureHeader: string;
} {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return { payload, signatureHeader: `t=${timestamp},v1=${signature}` };
}

export function createRespondingFetch(
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

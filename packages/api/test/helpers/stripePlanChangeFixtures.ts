import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { changeStripePlan } from "../../src/services/billing/stripePlanChange";
import { getDefaultApiServiceRuntime } from "../../src/services/runtime";
import { registerAndAuthenticateWithOrganization } from "./registerUser";
import { activeStripePrice } from "./stripeCatalog";
import {
  REVENUECAT_WEBHOOK_ENV as REVENUECAT_ENV,
  STRIPE_WEBHOOK_ENV as STRIPE_ENV,
} from "./stripeWebhook";

/**
 * An organization subscribed through Stripe, and a fake of its subscription,
 * for plan change tests (services/billing/stripePlanChange.ts).
 */

// Whole seconds, as Stripe reports periods.
const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1_000) * 1_000);
export const PERIOD_START = wholeSeconds(
  Date.now() - 10 * 24 * 60 * 60 * 1_000,
);
export const PERIOD_END = wholeSeconds(Date.now() + 20 * 24 * 60 * 60 * 1_000);
const PRICES: Readonly<Record<string, number>> = {
  price_sync: 500,
  price_team_5: 1_000,
  price_team_10: 2_000,
};
const TIER_PRICES: Readonly<Record<number, string>> = {
  1: "price_sync",
  5: "price_team_5",
  10: "price_team_10",
};

/**
 * One active Stripe subscription whose sync item's Price the fake keeps, so
 * a test sees what Stripe would charge at renewal. `decline` makes the
 * upgrade's prorated charge fail as a declined card does, leaving a pending
 * update with an open invoice until it is voided; `pendingInvoice` starts
 * with one, as an upgrade whose request died before voiding it leaves.
 */
function fakeStripeSubscription(input: {
  readonly decline?: boolean;
  readonly organizationId: string;
  pendingInvoice?: boolean;
  priceId: string;
}) {
  const writes: { readonly form: URLSearchParams; readonly path: string }[] =
    [];
  const voids: string[] = [];
  const subscription = () => ({
    id: `sub_${input.organizationId}`,
    status: "active",
    current_period_start: Math.floor(PERIOD_START.getTime() / 1_000),
    current_period_end: Math.floor(PERIOD_END.getTime() / 1_000),
    customer: "cus_plan",
    latest_invoice: "in_upgrade",
    metadata: { orgId: input.organizationId, userId: "user-plan" },
    pending_update: input.pendingInvoice ? { subscription_items: [] } : null,
    items: {
      data: [
        {
          id: `si_${input.organizationId}`,
          price: activeStripePrice(input.priceId, PRICES[input.priceId] ?? 0),
          quantity: 1,
        },
      ],
    },
  });
  const fetchImpl = (async (request: RequestInfo | URL, init?: RequestInit) => {
    // Recorded and routed with placeholder ids, so assertions read plainly.
    const pathname = new URL(String(request)).pathname
      .replace(`sub_${input.organizationId}`, "sub_plan")
      .replace(`si_${input.organizationId}`, "si_plan");
    const form = new URLSearchParams(String(init?.body ?? ""));
    const price = /^\/v1\/prices\/(\w+)$/.exec(pathname)?.[1];
    if (price) {
      return Response.json(activeStripePrice(price, PRICES[price] ?? 0));
    }
    if (init?.method === "POST") {
      writes.push({ form, path: pathname });
    }
    if (pathname === "/v1/subscriptions/sub_plan" && init?.method === "POST") {
      if (input.decline) {
        input.pendingInvoice = true;
      } else {
        input.priceId = form.get("items[0][price]") ?? input.priceId;
      }
      return Response.json(subscription());
    }
    if (pathname === "/v1/subscriptions/sub_plan") {
      return Response.json(subscription());
    }
    if (pathname === "/v1/subscription_items/si_plan") {
      input.priceId = form.get("price") ?? input.priceId;
      return Response.json({ id: "si_plan" });
    }
    if (pathname === "/v1/invoices/in_upgrade/void") {
      input.pendingInvoice = false;
      voids.push("in_upgrade");
      return Response.json({ id: "in_upgrade", status: "void" });
    }
    throw new Error(`Unexpected Stripe request: ${pathname}`);
  }) as typeof fetch;
  return { fetchImpl, voids, writes };
}

/**
 * An organization subscribed through Stripe at `seatCount`, whose Stripe item
 * is at `itemSeatCount` (default the same) and which renews at
 * `renewalSeatCount` (default the same).
 */
export async function subscribedOrganization(input: {
  readonly itemSeatCount?: number;
  readonly renewalSeatCount?: number;
  readonly seatCount: number;
}) {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const priceId = TIER_PRICES[input.seatCount] ?? "price_sync";
  await db
    .update(organizationBilling)
    .set({
      currentPeriodEndsAt: PERIOD_END,
      currentPeriodStartsAt: PERIOD_START,
      provider: "revenuecat",
      providerProductId: priceId,
      seatCount: input.seatCount,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  const seats = {
    appliedPaidCapacity: input.seatCount,
    // Bound and requested for the same paid period, as after a binding.
    appliedSeatPeriodKey: "plan-test-period",
    billingPeriodEndsAt: PERIOD_END,
    billingPeriodStartsAt: PERIOD_START,
    desiredPaidCapacity: input.seatCount,
    desiredRenewalQuantity: input.renewalSeatCount ?? input.seatCount,
    desiredRevision: 1,
    desiredSeatPeriodKey: "plan-test-period",
    priceId,
    subscriptionId: `sub_${organizationId}`,
    subscriptionItemId: `si_${organizationId}`,
  };
  // Registration already queued the organization's seat row.
  await db
    .insert(organizationBillingStripeSeats)
    .values({ ...seats, organizationId })
    .onConflictDoUpdate({
      target: organizationBillingStripeSeats.organizationId,
      set: seats,
    });
  const stripe = (decline = false, pendingInvoice = false) =>
    fakeStripeSubscription({
      decline,
      organizationId,
      pendingInvoice,
      priceId: TIER_PRICES[input.itemSeatCount ?? input.seatCount] ?? priceId,
    });
  const change = (
    planPriceId: string,
    fake: ReturnType<typeof stripe> = stripe(),
    currentSeatCount = input.seatCount,
  ) =>
    changeStripePlan(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      { currentSeatCount, priceId: planPriceId },
      {
        revenueCat: { env: REVENUECAT_ENV },
        stripe: { env: STRIPE_ENV, fetchImpl: fake.fetchImpl },
      },
    );
  return { admin, change, organizationId, stripe };
}

export async function readPlanState(organizationId: string) {
  const [billing] = await db
    .select({
      providerProductId: organizationBilling.providerProductId,
      seatCount: organizationBilling.seatCount,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  const [seats] = await db
    .select({
      appliedPaidCapacity: organizationBillingStripeSeats.appliedPaidCapacity,
      desiredRenewalQuantity:
        organizationBillingStripeSeats.desiredRenewalQuantity,
      leaseId: organizationBillingStripeSeats.leaseId,
      priceId: organizationBillingStripeSeats.priceId,
    })
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  return { billing, seats };
}

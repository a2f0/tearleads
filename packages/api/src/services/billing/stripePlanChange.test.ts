import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingSeatEvents,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { getSyncBillingTier } from "@tearleads/validators/billing";
import { eq } from "drizzle-orm";
import {
  registerAndAuthenticateWithOrganization,
  registerUser,
} from "../../../test/helpers/registerUser";
import { addEffectiveOrganizationMember } from "../../../test/helpers/revenuecatWebhook";
import { activeStripePrice } from "../../../test/helpers/stripeCatalog";
import {
  REVENUECAT_WEBHOOK_ENV as REVENUECAT_ENV,
  STRIPE_WEBHOOK_ENV as STRIPE_ENV,
} from "../../../test/helpers/stripeWebhook";
import {
  resolvePendingStripeSeatCount,
  runBeginStripePlanChangeWorkflow,
  runFinishStripePlanUpgradeWorkflow,
} from "../../workflows/billing/stripePlanChange";
import { getDefaultApiServiceRuntime } from "../runtime";
import { changeStripePlan } from "./stripePlanChange";

// Whole seconds, as Stripe reports periods.
const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1_000) * 1_000);
const PERIOD_START = wholeSeconds(Date.now() - 10 * 24 * 60 * 60 * 1_000);
const PERIOD_END = wholeSeconds(Date.now() + 20 * 24 * 60 * 60 * 1_000);
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
 * upgrade's prorated charge fail as a declined card does.
 */
function fakeStripeSubscription(input: {
  readonly decline?: boolean;
  readonly organizationId: string;
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
    metadata: { orgId: input.organizationId, userId: "user-plan" },
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
        return Response.json({
          ...subscription(),
          latest_invoice: "in_upgrade",
          pending_update: { subscription_items: [] },
        });
      }
      input.priceId = form.get("items[0][price]") ?? input.priceId;
      return Response.json({
        ...subscription(),
        latest_invoice: "in_upgrade",
        pending_update: null,
      });
    }
    if (pathname === "/v1/subscriptions/sub_plan") {
      return Response.json(subscription());
    }
    if (pathname === "/v1/subscription_items/si_plan") {
      input.priceId = form.get("price") ?? input.priceId;
      return Response.json({ id: "si_plan" });
    }
    if (pathname === "/v1/invoices/in_upgrade/void") {
      voids.push("in_upgrade");
      return Response.json({ id: "in_upgrade", status: "void" });
    }
    throw new Error(`Unexpected Stripe request: ${pathname}`);
  }) as typeof fetch;
  return { fetchImpl, voids, writes };
}

/** An organization subscribed through Stripe at `seatCount`. */
async function subscribedOrganization(input: {
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
    billingPeriodEndsAt: PERIOD_END,
    billingPeriodStartsAt: PERIOD_START,
    desiredPaidCapacity: input.seatCount,
    desiredRenewalQuantity: input.renewalSeatCount ?? input.seatCount,
    desiredRevision: 1,
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
  const stripe = (decline = false) =>
    fakeStripeSubscription({
      decline,
      organizationId,
      priceId: TIER_PRICES[input.itemSeatCount ?? input.seatCount] ?? priceId,
    });
  const change = (
    planPriceId: string,
    fake: ReturnType<typeof stripe> = stripe(),
  ) =>
    changeStripePlan(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      planPriceId,
      {
        revenueCat: { env: REVENUECAT_ENV },
        stripe: { env: STRIPE_ENV, fetchImpl: fake.fetchImpl },
      },
    );
  return { admin, change, organizationId, stripe };
}

async function readState(organizationId: string) {
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

test("an upgrade is charged now and its capacity applies once paid", async () => {
  const { change, organizationId, stripe } = await subscribedOrganization({
    seatCount: 1,
  });
  const fake = stripe();

  expect(await change("price_team_5", fake)).toBe("upgraded");

  const [write] = fake.writes;
  expect(write?.path).toBe("/v1/subscriptions/sub_plan");
  expect(write?.form.get("items[0][price]")).toBe("price_team_5");
  expect(write?.form.get("proration_behavior")).toBe("always_invoice");
  expect(write?.form.get("payment_behavior")).toBe("pending_if_incomplete");
  expect(await readState(organizationId)).toMatchObject({
    billing: { providerProductId: "price_team_5", seatCount: 5 },
    seats: {
      appliedPaidCapacity: 5,
      desiredRenewalQuantity: 5,
      leaseId: null,
      priceId: "price_team_5",
    },
  });
  const events = await db
    .select({ eventType: organizationBillingSeatEvents.eventType })
    .from(organizationBillingSeatEvents)
    .where(eq(organizationBillingSeatEvents.organizationId, organizationId));
  expect(events.map(({ eventType }) => eventType)).toContain(
    "licensed_seat_count_increased",
  );
});

test("a declined upgrade voids its invoice and changes nothing", async () => {
  const { change, organizationId, stripe } = await subscribedOrganization({
    seatCount: 1,
  });
  const fake = stripe(true);

  await expect(change("price_team_10", fake)).rejects.toMatchObject({
    code: "billing_plan_change_payment_failed",
    status: 409,
  });

  expect(fake.voids).toEqual(["in_upgrade"]);
  expect(await readState(organizationId)).toMatchObject({
    billing: { providerProductId: "price_sync", seatCount: 1 },
    seats: { desiredRenewalQuantity: 1, leaseId: null, priceId: "price_sync" },
  });
});

test("a downgrade is scheduled for renewal and keeps the paid capacity", async () => {
  const { change, organizationId, stripe } = await subscribedOrganization({
    seatCount: 5,
  });
  const fake = stripe();

  expect(await change("price_sync", fake)).toBe("scheduled");

  // Nothing is charged or credited now; the seat-sync worker lowers the
  // Price Stripe renews at.
  expect(fake.writes).toEqual([]);
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 5 },
    seats: { appliedPaidCapacity: 5, desiredRenewalQuantity: 1 },
  });
  expect(
    await resolvePendingStripeSeatCount(db, organizationId, {
      seatCount: 5,
      status: "active",
    }),
  ).toBe(1);

  // Choosing the current plan again cancels the scheduled change.
  expect(await change("price_team_5", fake)).toBe("kept");
  expect(await readState(organizationId)).toMatchObject({
    seats: { desiredRenewalQuantity: 5 },
  });
});

test("a plan smaller than the roster is refused until members are removed", async () => {
  const { admin, change, organizationId } = await subscribedOrganization({
    seatCount: 5,
  });
  const member = createTestUser();
  await registerUser(member);
  await addEffectiveOrganizationMember({
    actor: admin,
    organizationId,
    userId: member.userId,
  });

  await expect(change("price_sync")).rejects.toMatchObject({
    code: "billing_plan_change_unavailable",
    status: 409,
  });
  expect(await readState(organizationId)).toMatchObject({
    seats: { desiredRenewalQuantity: 5 },
  });
});

test("an upgrade after a scheduled downgrade is charged from the paid plan", async () => {
  // The worker already lowered the item to Solo for renewal; Stripe would
  // prorate from Solo, though Team 5 was paid for this period.
  const { change, organizationId, stripe } = await subscribedOrganization({
    itemSeatCount: 1,
    renewalSeatCount: 1,
    seatCount: 5,
  });
  const fake = stripe();

  expect(await change("price_team_10", fake)).toBe("upgraded");

  expect(
    fake.writes.map(({ form, path }) => [
      path,
      form.get("price") ?? form.get("items[0][price]"),
      form.get("proration_behavior"),
    ]),
  ).toEqual([
    ["/v1/subscription_items/si_plan", "price_team_5", "none"],
    ["/v1/subscriptions/sub_plan", "price_team_10", "always_invoice"],
  ]);
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 10 },
    seats: { desiredRenewalQuantity: 10, priceId: "price_team_10" },
  });
});

test("a plan change still being applied refuses another", async () => {
  const { change, organizationId } = await subscribedOrganization({
    seatCount: 1,
  });
  await db
    .update(organizationBillingStripeSeats)
    .set({
      leaseExpiresAt: new Date(Date.now() + 60_000),
      leaseId: "plan:other",
    })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));

  await expect(change("price_team_5")).rejects.toMatchObject({
    code: "billing_plan_change_unavailable",
    status: 409,
  });
});

test("a Stripe subscription quarantined under native ownership cannot change", async () => {
  const { change, organizationId, stripe } = await subscribedOrganization({
    seatCount: 1,
  });
  // A native store took ownership; the retained Stripe identity lost its
  // Price and owns no capacity.
  await db
    .update(organizationBillingStripeSeats)
    .set({ priceId: null })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  const fake = stripe();

  await expect(change("price_team_5", fake)).rejects.toMatchObject({
    code: "billing_plan_change_unavailable",
    status: 409,
  });
  expect(fake.writes).toEqual([]);
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 1 },
  });
});

test("an upgrade waits while Stripe has renewed into a period not yet bound", async () => {
  const { change, organizationId, stripe } = await subscribedOrganization({
    seatCount: 5,
  });
  // Stripe already renewed (the fake reports the current period), but the
  // renewal's webhooks have not arrived: the bound period is the last one.
  await db
    .update(organizationBillingStripeSeats)
    .set({
      billingPeriodEndsAt: PERIOD_START,
      billingPeriodStartsAt: new Date(
        PERIOD_START.getTime() - 30 * 24 * 60 * 60 * 1_000,
      ),
    })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  const fake = stripe();

  await expect(change("price_team_10", fake)).rejects.toMatchObject({
    code: "billing_plan_change_unavailable",
    status: 409,
  });
  expect(fake.writes).toEqual([]);
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 5 },
    seats: { desiredRenewalQuantity: 5, leaseId: null },
  });
});

test("an upgrade finishing after its lease lapsed keeps a newer renewal choice", async () => {
  const { admin, organizationId } = await subscribedOrganization({
    seatCount: 5,
  });
  const started = new Date();
  const later = (minutes: number) =>
    new Date(started.getTime() + minutes * 60_000);
  const upgrade = await runBeginStripePlanChangeWorkflow(
    db,
    organizationId,
    admin.userId,
    { now: started, plan: getSyncBillingTier("team_10") },
  );
  if (upgrade.kind !== "upgrade") throw new Error("expected an upgrade");
  // The upgrade stalled past its lease; the admin then chose a smaller plan.
  expect(
    await runBeginStripePlanChangeWorkflow(db, organizationId, admin.userId, {
      now: later(6),
      plan: getSyncBillingTier("solo"),
    }),
  ).toEqual({ kind: "scheduled" });

  await runFinishStripePlanUpgradeWorkflow(db, {
    leaseId: upgrade.leaseId,
    now: later(7),
    organizationId,
    plan: getSyncBillingTier("team_10"),
    priceId: "price_team_10",
    subscriptionId: upgrade.subscriptionId,
  });

  // The charge went through, so its capacity applies; the newer choice of
  // renewal plan stands, and the worker reconciles the Price from Stripe.
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 10 },
    seats: {
      appliedPaidCapacity: 10,
      desiredRenewalQuantity: 1,
      priceId: "price_team_5",
    },
  });
});

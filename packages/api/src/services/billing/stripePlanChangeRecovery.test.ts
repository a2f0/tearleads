import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBillingStripeSeats } from "@tearleads/api-shared/schema";
import { getSyncBillingTier } from "@tearleads/validators/billing";
import { eq } from "drizzle-orm";
import {
  PERIOD_END,
  PERIOD_START,
  readPlanState as readState,
  subscribedOrganization,
} from "../../../test/helpers/stripePlanChangeFixtures";
import { STRIPE_WEBHOOK_ENV as STRIPE_ENV } from "../../../test/helpers/stripeWebhook";
import {
  runBeginStripePlanChangeWorkflow,
  runFinishStripePlanUpgradeWorkflow,
} from "../../workflows/billing/stripePlanChange";
import { runBindOrganizationStripeSeatsWorkflow } from "../../workflows/billing/stripeSeatState";
import { getDefaultApiServiceRuntime } from "../runtime";
import { runStripeSeatSynchronization } from "./stripeSeatSync";

/**
 * Plan upgrades that meet a renewal, a lapsed lease, or a lost response:
 * capacity follows only what Stripe was paid for in the period it covers.
 */

const TEAM_10 = getSyncBillingTier("team_10");

async function beginTeam10Upgrade(
  organizationId: string,
  userId: string,
  now = new Date(),
) {
  const upgrade = await runBeginStripePlanChangeWorkflow(
    db,
    organizationId,
    userId,
    { currentSeatCount: 5, now, observed: null, plan: TEAM_10 },
  );
  if (upgrade.kind !== "upgrade") throw new Error("expected an upgrade");
  return upgrade;
}

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

test("a renewal choice waits while a paid upgrade is not yet recorded", async () => {
  // Stripe charged an upgrade to Team 10 whose request died before
  // recording it; the worker records it once the lease lapses.
  const { change, organizationId } = await subscribedOrganization({
    itemSeatCount: 10,
    seatCount: 5,
  });

  await expect(change("price_sync")).rejects.toMatchObject({
    code: "billing_plan_change_unavailable",
    status: 409,
  });
  expect(await readState(organizationId)).toMatchObject({
    seats: { desiredRenewalQuantity: 5 },
  });
});

test("the worker voids the open invoice an interrupted declined upgrade left", async () => {
  const { organizationId, stripe } = await subscribedOrganization({
    seatCount: 5,
  });
  await db
    .update(organizationBillingStripeSeats)
    .set({ nextAttemptAt: new Date("2020-01-01T00:00:00.000Z") })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  const fake = stripe(false, true);

  expect(
    await runStripeSeatSynchronization(
      getDefaultApiServiceRuntime(),
      { limit: 1 },
      { stripe: { env: STRIPE_ENV, fetchImpl: fake.fetchImpl } },
    ),
  ).toMatchObject({ synced: 1 });
  expect(fake.voids).toEqual(["in_upgrade"]);
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 5 },
    seats: { appliedPaidCapacity: 5, priceId: "price_team_5" },
  });
});

test("an upgrade finishing after its lease lapsed keeps a newer renewal choice", async () => {
  const { admin, organizationId } = await subscribedOrganization({
    seatCount: 5,
  });
  const started = new Date();
  const later = (minutes: number) =>
    new Date(started.getTime() + minutes * 60_000);
  const upgrade = await beginTeam10Upgrade(
    organizationId,
    admin.userId,
    started,
  );
  // The upgrade stalled past its lease, Stripe still at Team 5; the admin
  // then chose a smaller plan.
  expect(
    await runBeginStripePlanChangeWorkflow(db, organizationId, admin.userId, {
      currentSeatCount: 5,
      now: later(6),
      observed: {
        billingPeriodStartsAt: PERIOD_START,
        seatCount: 5,
        subscriptionId: upgrade.subscriptionId,
      },
      plan: getSyncBillingTier("solo"),
    }),
  ).toEqual({ kind: "scheduled" });

  await runFinishStripePlanUpgradeWorkflow(db, {
    leaseId: upgrade.leaseId,
    now: later(7),
    organizationId,
    paidPeriodEndsAt: upgrade.paidPeriodEndsAt,
    plan: TEAM_10,
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

test("an upgrade finishing after a renewal grants nothing to the new period", async () => {
  const { admin, organizationId } = await subscribedOrganization({
    seatCount: 5,
  });
  const upgrade = await beginTeam10Upgrade(organizationId, admin.userId);
  // Before the request finished, the renewal was bound: its invoice already
  // charged whatever the subscription renews at.
  await db
    .update(organizationBillingStripeSeats)
    .set({
      billingPeriodEndsAt: new Date(PERIOD_END.getTime() + 30 * 86_400_000),
      billingPeriodStartsAt: PERIOD_END,
    })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));

  await runFinishStripePlanUpgradeWorkflow(db, {
    leaseId: upgrade.leaseId,
    organizationId,
    paidPeriodEndsAt: upgrade.paidPeriodEndsAt,
    plan: TEAM_10,
    priceId: "price_team_10",
    subscriptionId: upgrade.subscriptionId,
  });

  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 5 },
    seats: { appliedPaidCapacity: 5, priceId: "price_team_5" },
  });
});

test("a paid upgrade whose request never finished is granted by the seat-sync worker", async () => {
  // Stripe applied and charged the upgrade (the item is at Team 10), but the
  // request's response was lost before it recorded anything.
  const { admin, organizationId, stripe } = await subscribedOrganization({
    itemSeatCount: 10,
    seatCount: 5,
  });
  await beginTeam10Upgrade(organizationId, admin.userId);
  // Long ago, so its lapsed lease is the worker's next due row.
  const lapsed = new Date("2020-01-01T00:00:00.000Z");
  await db
    .update(organizationBillingStripeSeats)
    .set({ leaseExpiresAt: lapsed, nextAttemptAt: lapsed })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));

  expect(
    await runStripeSeatSynchronization(
      getDefaultApiServiceRuntime(),
      { limit: 1 },
      { stripe: { env: STRIPE_ENV, fetchImpl: stripe().fetchImpl } },
    ),
  ).toMatchObject({ synced: 1 });
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 10 },
    seats: { appliedPaidCapacity: 10, priceId: "price_team_10" },
  });
});

test("an upgrade that never reached Stripe keeps the scheduled smaller plan", async () => {
  // Team 5 renews at Solo (the worker already lowered the item); an upgrade
  // began but its request died before Stripe was charged.
  const { admin, organizationId, stripe } = await subscribedOrganization({
    itemSeatCount: 1,
    renewalSeatCount: 1,
    seatCount: 5,
  });
  await beginTeam10Upgrade(organizationId, admin.userId);
  const lapsed = new Date("2020-01-01T00:00:00.000Z");
  await db
    .update(organizationBillingStripeSeats)
    .set({ leaseExpiresAt: lapsed, nextAttemptAt: lapsed })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  const fake = stripe();

  expect(
    await runStripeSeatSynchronization(
      getDefaultApiServiceRuntime(),
      { limit: 1 },
      { stripe: { env: STRIPE_ENV, fetchImpl: fake.fetchImpl } },
    ),
  ).toMatchObject({ synced: 1 });
  expect(fake.writes).toEqual([]);
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 5 },
    seats: { appliedPaidCapacity: 5, desiredRenewalQuantity: 1 },
  });
});

test("extending the paid period keeps its capacity after a scheduled downgrade", async () => {
  const { organizationId } = await subscribedOrganization({
    itemSeatCount: 1,
    renewalSeatCount: 1,
    seatCount: 5,
  });

  // Same subscription and start, a later end, and the bound Price already
  // the scheduled Solo plan's.
  expect(
    await runBindOrganizationStripeSeatsWorkflow(db, {
      billingPeriodEndsAt: new Date(PERIOD_END.getTime() + 7 * 86_400_000),
      billingPeriodStartsAt: PERIOD_START,
      customerId: "cus_plan",
      organizationId,
      priceId: "price_sync",
      seatQuantity: 1,
      subscriptionId: `sub_${organizationId}`,
      subscriptionItemId: `si_${organizationId}`,
    }),
  ).toEqual({ status: "accepted" });

  expect(await readState(organizationId)).toMatchObject({
    seats: { appliedPaidCapacity: 5, desiredRenewalQuantity: 1 },
  });
});

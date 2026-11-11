import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { getSyncBillingTier } from "@tearleads/validators/billing";
import { eq } from "drizzle-orm";
import {
  PERIOD_END,
  PERIOD_START,
  readPlanState as readState,
  subscribedOrganization,
} from "../../../test/helpers/stripePlanChangeFixtures";
import { STRIPE_WEBHOOK_ENV as STRIPE_ENV } from "../../../test/helpers/stripeWebhook";
import { runBeginStripePlanChangeWorkflow } from "../../workflows/billing/stripePlanChange";
import { runFinishStripePlanUpgradeWorkflow } from "../../workflows/billing/stripePlanUpgradeSettlement";
import {
  requestOrganizationStripeSeatSync,
  runBindOrganizationStripeSeatsWorkflow,
} from "../../workflows/billing/stripeSeatState";
import {
  claimOrganizationStripeSeatSync,
  runCompleteOrganizationStripeSeatSyncWorkflow,
} from "../../workflows/billing/stripeSeatSyncClaim";
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
    {
      currentSeatCount: 5,
      now,
      observed: {
        billingPeriodStartsAt: PERIOD_START,
        seatCount: 5,
        subscriptionId: `sub_${organizationId}`,
      },
      plan: TEAM_10,
    },
  );
  if (upgrade.kind !== "upgrade") throw new Error("expected an upgrade");
  return upgrade;
}

test("every plan change waits while Stripe has renewed into a period not yet bound", async () => {
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

  // An upgrade would be charged from, and a downgrade scheduled against,
  // the previous period's plan.
  for (const priceId of ["price_team_10", "price_sync"]) {
    await expect(change(priceId, fake)).rejects.toMatchObject({
      code: "billing_plan_change_unavailable",
      status: 409,
    });
  }
  expect(fake.writes).toEqual([]);
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 5 },
    seats: { desiredRenewalQuantity: 5, leaseId: null },
  });
});

test("a paid upgrade bound by a webhook before it is recorded renews at its plan", async () => {
  // Stripe charged a Team 5 → Team 10 upgrade whose request died; an
  // extension's webhook binds the Team 10 Price before the worker runs.
  const { change, organizationId } = await subscribedOrganization({
    itemSeatCount: 10,
    seatCount: 5,
  });
  await runBindOrganizationStripeSeatsWorkflow(db, {
    billingPeriodEndsAt: new Date(PERIOD_END.getTime() + 7 * 86_400_000),
    billingPeriodStartsAt: PERIOD_START,
    customerId: "cus_plan",
    organizationId,
    priceId: "price_team_10",
    seatQuantity: 10,
    subscriptionId: `sub_${organizationId}`,
    subscriptionItemId: `si_${organizationId}`,
  });

  // The worker keeps the Team 10 Price rather than restoring Team 5.
  expect(await readState(organizationId)).toMatchObject({
    seats: { appliedPaidCapacity: 10, desiredRenewalQuantity: 10 },
  });
  // Until the worker grants it, a renewal choice waits.
  await expect(change("price_sync")).rejects.toMatchObject({
    code: "billing_plan_change_unavailable",
  });
});

test("every plan change waits while billing still tracks the previous period", async () => {
  // Stripe's webhooks bound the renewal into Solo before RevenueCat moved
  // billing on from the previous period's Team 5.
  const { change, organizationId, stripe } = await subscribedOrganization({
    itemSeatCount: 1,
    seatCount: 5,
  });
  await db
    .update(organizationBilling)
    .set({
      currentPeriodEndsAt: PERIOD_START,
      currentPeriodStartsAt: new Date(PERIOD_START.getTime() - 30 * 86_400_000),
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  await db
    .update(organizationBillingStripeSeats)
    .set({ appliedPaidCapacity: 1, desiredRenewalQuantity: 1 })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  const fake = stripe();

  // Team 10 would be charged from the Team 5 capacity of the old period.
  await expect(change("price_team_10", fake)).rejects.toMatchObject({
    code: "billing_plan_change_unavailable",
  });
  expect(fake.writes).toEqual([]);
});

test("every plan change waits while a paid upgrade is not yet recorded", async () => {
  // Stripe charged a Solo → Team 10 upgrade whose request died before
  // recording it; the worker grants and records it once the lease lapses.
  const { change, organizationId, stripe } = await subscribedOrganization({
    itemSeatCount: 10,
    seatCount: 1,
  });
  const fake = stripe();

  // Team 5 is still an upgrade from the recorded Solo, but would be charged
  // as a downgrade from the Team 10 already paid for.
  for (const priceId of ["price_team_5", "price_sync"]) {
    await expect(change(priceId, fake)).rejects.toMatchObject({
      code: "billing_plan_change_unavailable",
      status: 409,
    });
  }
  expect(fake.writes).toEqual([]);
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 1 },
    seats: { desiredRenewalQuantity: 1, leaseId: null },
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

test("a stalled upgrade fences newer choices until it settles", async () => {
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
  // The upgrade stalled past its lease with Stripe still at Team 5: its
  // charge may yet apply, so a newer choice waits for it to settle.
  await expect(
    runBeginStripePlanChangeWorkflow(db, organizationId, admin.userId, {
      currentSeatCount: 5,
      now: later(6),
      observed: {
        billingPeriodStartsAt: PERIOD_START,
        seatCount: 5,
        subscriptionId: upgrade.subscriptionId,
      },
      plan: getSyncBillingTier("solo"),
    }),
  ).rejects.toMatchObject({ code: "billing_plan_change_unavailable" });

  // The paid upgrade then finishes, still holding the row, so it records
  // both its capacity and its plan.
  await runFinishStripePlanUpgradeWorkflow(db, {
    leaseId: upgrade.leaseId,
    now: later(7),
    organizationId,
    paidPeriodEndsAt: upgrade.paidPeriodEndsAt,
    paidPeriodStartsAt: upgrade.paidPeriodStartsAt,
    plan: TEAM_10,
    priceId: "price_team_10",
    subscriptionId: upgrade.subscriptionId,
  });
  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 10 },
    seats: {
      appliedPaidCapacity: 10,
      desiredRenewalQuantity: 10,
      leaseId: null,
      priceId: "price_team_10",
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
    paidPeriodStartsAt: upgrade.paidPeriodStartsAt,
    plan: TEAM_10,
    priceId: "price_team_10",
    subscriptionId: upgrade.subscriptionId,
  });

  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 5 },
    seats: { appliedPaidCapacity: 5, priceId: "price_team_5" },
  });
});

test("an upgrade finishing after a RevenueCat renewal grants nothing to it", async () => {
  const { admin, organizationId } = await subscribedOrganization({
    seatCount: 5,
  });
  const upgrade = await beginTeam10Upgrade(organizationId, admin.userId);
  // RevenueCat delivered the renewal into a smaller scheduled plan before
  // Stripe's webhooks bound it: the seat row still holds the paid period.
  await db
    .update(organizationBilling)
    .set({
      currentPeriodEndsAt: new Date(PERIOD_END.getTime() + 30 * 86_400_000),
      currentPeriodStartsAt: PERIOD_END,
      seatCount: 1,
    })
    .where(eq(organizationBilling.organizationId, organizationId));

  await runFinishStripePlanUpgradeWorkflow(db, {
    leaseId: upgrade.leaseId,
    organizationId,
    paidPeriodEndsAt: upgrade.paidPeriodEndsAt,
    paidPeriodStartsAt: upgrade.paidPeriodStartsAt,
    plan: TEAM_10,
    priceId: "price_team_10",
    subscriptionId: upgrade.subscriptionId,
  });

  expect(await readState(organizationId)).toMatchObject({
    billing: { seatCount: 1 },
    seats: { appliedPaidCapacity: 5 },
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

type Subscribed = Awaited<ReturnType<typeof subscribedOrganization>>;

/**
 * The worker claims a row whose Stripe item a lost upgrade raised to Team
 * 10, `meanwhile` runs while it reads Stripe, and the claim then completes
 * with Team 10 recovered as the renewal plan.
 */
async function recoverUpgradeWhile(
  meanwhile: (subscribed: Subscribed) => Promise<void>,
) {
  const subscribed = await subscribedOrganization({
    itemSeatCount: 10,
    seatCount: 5,
  });
  const { organizationId } = subscribed;
  await db
    .update(organizationBillingStripeSeats)
    .set({ nextAttemptAt: new Date("2000-01-01T00:00:00.000Z") })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  const claim = await claimOrganizationStripeSeatSync(db, new Date());
  if (claim?.organizationId !== organizationId) {
    throw new Error("expected this organization's claim");
  }
  await meanwhile(subscribed);
  await runCompleteOrganizationStripeSeatSyncWorkflow(db, {
    appliedPaidCapacity: 10,
    billingPeriodEndsAt: PERIOD_END,
    billingPeriodStartsAt: PERIOD_START,
    claim,
    desiredRenewalQuantity: 10,
    now: new Date(),
    observedQuantity: 10,
    priceId: "price_team_10",
    subscriptionItemId: `si_${organizationId}`,
  });
  return subscribed;
}

test("a renewal choice waits while the worker recovers an upgrade", async () => {
  const { change, organizationId } = await recoverUpgradeWhile(
    async ({ change, organizationId }) => {
      // The interrupted upgrade settled; the admin then tries Team 5.
      await db
        .update(organizationBilling)
        .set({ seatCount: 10 })
        .where(eq(organizationBilling.organizationId, organizationId));
      await expect(change("price_team_5", undefined, 10)).rejects.toMatchObject(
        { code: "billing_plan_change_unavailable" },
      );
    },
  );
  expect(await readState(organizationId)).toMatchObject({
    seats: { desiredRenewalQuantity: 10, leaseId: null },
  });

  // Once the claim completed, the same choice is scheduled.
  expect(await change("price_team_5", undefined, 10)).toBe("scheduled");
  expect(await readState(organizationId)).toMatchObject({
    seats: { desiredRenewalQuantity: 5 },
  });
});

test("a roster change while the worker recovers an upgrade keeps its plan", async () => {
  const { organizationId } = await recoverUpgradeWhile(({ organizationId }) =>
    requestOrganizationStripeSeatSync({
      desiredPaidCapacity: 5,
      desiredSeatPeriodKey: "plan-test-period",
      executor: db,
      licensedSeatCount: 5,
      now: new Date(),
      organizationId,
    }),
  );
  expect(await readState(organizationId)).toMatchObject({
    seats: { desiredRenewalQuantity: 10 },
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

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
  readPlanState,
  subscribedOrganization,
} from "../../../test/helpers/stripePlanChangeFixtures";
import { STRIPE_WEBHOOK_ENV as STRIPE_ENV } from "../../../test/helpers/stripeWebhook";
import { organizationSeatPeriodKey } from "../../billing/organizationBilling";
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
 * RevenueCat reports a Stripe subscription's period with timestamps that can
 * trail Stripe's slightly, and an extension moves only a period's end; plan
 * changes treat each as the same period.
 */

async function beginTeam10(
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
      plan: getSyncBillingTier("team_10"),
    },
  );
  if (upgrade.kind !== "upgrade") throw new Error("expected an upgrade");
  return upgrade;
}

const TRAIL_MS = 5_000;

function paidPeriodKey(offsetMs: number): string {
  return organizationSeatPeriodKey({
    currentPeriodEndsAt: new Date(PERIOD_END.getTime() + offsetMs),
    currentPeriodStartsAt: new Date(PERIOD_START.getTime() + offsetMs),
    status: "active",
    trialEndsAt: null,
  });
}

async function makeDue(organizationId: string, lease = {}): Promise<void> {
  await db
    .update(organizationBillingStripeSeats)
    .set({ ...lease, nextAttemptAt: new Date("2020-01-01T00:00:00.000Z") })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
}

async function synchronize(fetchImpl: typeof fetch): Promise<void> {
  await runStripeSeatSynchronization(
    getDefaultApiServiceRuntime(),
    { limit: 1 },
    { stripe: { env: STRIPE_ENV, fetchImpl } },
  );
}

test("a roster write for the same period never charges a scheduled downgrade again", async () => {
  // Team 5 renews at Solo, and the worker already lowered the item.
  const { organizationId, stripe } = await subscribedOrganization({
    itemSeatCount: 1,
    renewalSeatCount: 1,
    seatCount: 5,
  });
  await db
    .update(organizationBillingStripeSeats)
    .set({
      appliedSeatPeriodKey: paidPeriodKey(0),
      desiredSeatPeriodKey: paidPeriodKey(0),
    })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  // A roster change keyed by RevenueCat's spelling of the same period.
  await requestOrganizationStripeSeatSync({
    desiredPaidCapacity: 5,
    desiredSeatPeriodKey: paidPeriodKey(TRAIL_MS),
    executor: db,
    licensedSeatCount: 5,
    now: new Date(),
    organizationId,
  });
  const fake = stripe();

  for (const _run of [1, 2]) {
    await makeDue(organizationId);
    await synchronize(fake.fetchImpl);
  }

  expect(fake.writes).toEqual([]);
  expect(await readPlanState(organizationId)).toMatchObject({
    seats: { appliedPaidCapacity: 5, priceId: "price_sync" },
  });
});

test("a recovered upgrade is granted when RevenueCat's period trails Stripe's", async () => {
  // Stripe charged an upgrade to Team 10 whose request died.
  const { organizationId, stripe } = await subscribedOrganization({
    itemSeatCount: 10,
    seatCount: 5,
  });
  await db
    .update(organizationBilling)
    .set({
      currentPeriodEndsAt: new Date(PERIOD_END.getTime() + TRAIL_MS),
      currentPeriodStartsAt: new Date(PERIOD_START.getTime() + TRAIL_MS),
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  const lapsed = new Date("2020-01-01T00:00:00.000Z");
  await makeDue(organizationId, {
    leaseExpiresAt: lapsed,
    leaseId: "plan:lost",
  });

  await synchronize(stripe().fetchImpl);

  expect(await readPlanState(organizationId)).toMatchObject({
    billing: { seatCount: 10 },
    seats: { appliedPaidCapacity: 10, desiredRenewalQuantity: 10 },
  });
});

test("an extension bound while an upgrade is paid keeps the upgrade", async () => {
  const { admin, organizationId } = await subscribedOrganization({
    seatCount: 5,
  });
  const upgrade = await beginTeam10(organizationId, admin.userId);
  // An extension's webhook moves the bound period's end, not its start.
  await db
    .update(organizationBillingStripeSeats)
    .set({ billingPeriodEndsAt: new Date(PERIOD_END.getTime() + 86_400_000) })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));

  await runFinishStripePlanUpgradeWorkflow(db, {
    leaseId: upgrade.leaseId,
    organizationId,
    paidPeriodEndsAt: upgrade.paidPeriodEndsAt,
    paidPeriodStartsAt: upgrade.paidPeriodStartsAt,
    plan: getSyncBillingTier("team_10"),
    priceId: "price_team_10",
    subscriptionId: upgrade.subscriptionId,
  });

  expect(await readPlanState(organizationId)).toMatchObject({
    billing: { seatCount: 10 },
    seats: { appliedPaidCapacity: 10, desiredRenewalQuantity: 10 },
  });
});

test("an extension bound during an upgrade keeps the upgrade's lease", async () => {
  const { admin, organizationId } = await subscribedOrganization({
    seatCount: 5,
  });
  const upgrade = await beginTeam10(organizationId, admin.userId);

  await runBindOrganizationStripeSeatsWorkflow(db, {
    billingPeriodEndsAt: new Date(PERIOD_END.getTime() + 86_400_000),
    billingPeriodStartsAt: PERIOD_START,
    customerId: "cus_plan",
    organizationId,
    priceId: "price_team_5",
    seatQuantity: 5,
    subscriptionId: `sub_${organizationId}`,
    subscriptionItemId: `si_${organizationId}`,
  });

  // The worker still cannot write the Price while the upgrade is paid.
  expect(await readPlanState(organizationId)).toMatchObject({
    seats: { leaseId: upgrade.leaseId },
  });
});

test("an upgrade waits when the subscription renews within the hour", async () => {
  const { admin, organizationId } = await subscribedOrganization({
    seatCount: 5,
  });

  await expect(
    beginTeam10(
      organizationId,
      admin.userId,
      new Date(PERIOD_END.getTime() - 2 * 60_000),
    ),
  ).rejects.toMatchObject({ code: "billing_plan_change_unavailable" });
  expect(await readPlanState(organizationId)).toMatchObject({
    seats: { leaseId: null },
  });
});

test("every plan change waits while billing's period is unknown", async () => {
  // Stripe renewed Team 5 into Solo; billing has not placed its period yet.
  const { change, organizationId, stripe } = await subscribedOrganization({
    itemSeatCount: 1,
    seatCount: 5,
  });
  await db
    .update(organizationBilling)
    .set({ currentPeriodStartsAt: null })
    .where(eq(organizationBilling.organizationId, organizationId));
  await db
    .update(organizationBillingStripeSeats)
    .set({ appliedPaidCapacity: 1, desiredRenewalQuantity: 1 })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  const fake = stripe();

  // Team 10 would otherwise be charged from Team 5 never paid this period.
  await expect(change("price_team_10", fake)).rejects.toMatchObject({
    code: "billing_plan_change_unavailable",
  });
  expect(fake.writes).toEqual([]);
});

test("a late upgrade settled during a worker claim keeps its paid capacity", async () => {
  const { admin, organizationId } = await subscribedOrganization({
    seatCount: 5,
  });
  const upgrade = await beginTeam10(organizationId, admin.userId);
  // The upgrade's lease lapsed; the worker claimed the row and read Team 5.
  const lapsed = new Date("2000-01-01T00:00:00.000Z");
  await makeDue(organizationId, { leaseExpiresAt: lapsed });
  const claim = await claimOrganizationStripeSeatSync(db, new Date());
  if (claim?.organizationId !== organizationId) {
    throw new Error("expected this organization's claim");
  }
  // The paid upgrade settles late, without its lease.
  await runFinishStripePlanUpgradeWorkflow(db, {
    leaseId: upgrade.leaseId,
    organizationId,
    paidPeriodEndsAt: upgrade.paidPeriodEndsAt,
    paidPeriodStartsAt: upgrade.paidPeriodStartsAt,
    plan: getSyncBillingTier("team_10"),
    priceId: "price_team_10",
    subscriptionId: upgrade.subscriptionId,
  });

  await runCompleteOrganizationStripeSeatSyncWorkflow(db, {
    appliedPaidCapacity: 5,
    billingPeriodEndsAt: PERIOD_END,
    billingPeriodStartsAt: PERIOD_START,
    claim,
    desiredRenewalQuantity: null,
    now: new Date(),
    observedQuantity: 5,
    priceId: "price_team_5",
    subscriptionItemId: `si_${organizationId}`,
  });

  // Recording what the claim saw never takes back the capacity paid for,
  // so no later claim prorates for it again.
  expect(await readPlanState(organizationId)).toMatchObject({
    billing: { seatCount: 10 },
    seats: { appliedPaidCapacity: 10 },
  });
});

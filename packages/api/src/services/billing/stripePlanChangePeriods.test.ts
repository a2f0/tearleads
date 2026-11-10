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
import { requestOrganizationStripeSeatSync } from "../../workflows/billing/stripeSeatState";
import { getDefaultApiServiceRuntime } from "../runtime";
import { runStripeSeatSynchronization } from "./stripeSeatSync";

/**
 * RevenueCat reports a Stripe subscription's period with timestamps that can
 * trail Stripe's slightly, and an extension moves only a period's end; plan
 * changes treat each as the same period.
 */

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
  const upgrade = await runBeginStripePlanChangeWorkflow(
    db,
    organizationId,
    admin.userId,
    {
      currentSeatCount: 5,
      observed: {
        billingPeriodStartsAt: PERIOD_START,
        seatCount: 5,
        subscriptionId: `sub_${organizationId}`,
      },
      plan: getSyncBillingTier("team_10"),
    },
  );
  if (upgrade.kind !== "upgrade") throw new Error("expected an upgrade");
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

import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBillingStripeSeats } from "@tearleads/api-shared/schema";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import { STRIPE_WEBHOOK_ENV as STRIPE_ENV } from "../../../test/helpers/stripeWebhook";
import {
  lockedDurableStripeSeatCount,
  resolveImmutableStripeStoreOrganizationId,
} from "./revenuecatStripeResolution";

const PERIOD_START = new Date("2030-01-01T00:00:00.000Z");
const PERIOD_END = new Date("2030-02-01T00:00:00.000Z");
const NEXT_PERIOD_END = new Date("2030-03-01T00:00:00.000Z");

/**
 * A subscription that paid for Team 5 this period and renews at Solo: the
 * seat-sync worker already lowered its Price for the scheduled downgrade.
 */
async function scheduledDowngrade() {
  const organizationId = crypto.randomUUID();
  await db.insert(organizationBillingStripeSeats).values({
    appliedPaidCapacity: 5,
    billingPeriodEndsAt: PERIOD_END,
    billingPeriodStartsAt: PERIOD_START,
    desiredPaidCapacity: 5,
    desiredRenewalQuantity: 1,
    organizationId,
    priceId: "price_sync",
    subscriptionId: `sub_${organizationId}`,
    subscriptionItemId: `si_${organizationId}`,
  });
  return organizationId;
}

function stripeEvent(
  organizationId: string,
  type: string,
  period: { readonly endsAt: Date; readonly startsAt: Date },
): RevenueCatWebhookEvent {
  return {
    app_user_id: `user_${organizationId}`,
    event_timestamp_ms: Date.now(),
    expiration_at_ms: period.endsAt.getTime(),
    id: crypto.randomUUID(),
    original_transaction_id: `sub_${organizationId}`,
    purchased_at_ms: period.startsAt.getTime(),
    store: "STRIPE",
    type,
  } as RevenueCatWebhookEvent;
}

async function grantedSeats(event: RevenueCatWebhookEvent) {
  return resolveImmutableStripeStoreOrganizationId(db, event, {
    env: STRIPE_ENV,
  });
}

test("a mid-period event keeps the capacity paid before a scheduled downgrade", async () => {
  const organizationId = await scheduledDowngrade();

  expect(
    await grantedSeats(
      stripeEvent(organizationId, "UNCANCELLATION", {
        endsAt: PERIOD_END,
        startsAt: PERIOD_START,
      }),
    ),
  ).toMatchObject({ kind: "resolved", priceId: "price_sync", seatCount: 5 });
});

test("a same-period event reported moments after Stripe's start keeps the paid capacity", async () => {
  const organizationId = await scheduledDowngrade();

  // RevenueCat's timestamps for one period can trail Stripe's slightly.
  expect(
    await grantedSeats(
      stripeEvent(organizationId, "UNCANCELLATION", {
        endsAt: new Date(PERIOD_END.getTime() + 5_000),
        startsAt: new Date(PERIOD_START.getTime() + 5_000),
      }),
    ),
  ).toMatchObject({ kind: "resolved", seatCount: 5 });
});

test("an extension of the paid period keeps its capacity", async () => {
  const organizationId = await scheduledDowngrade();

  // The period's end moves later, but no new period was paid for.
  expect(
    await grantedSeats(
      stripeEvent(organizationId, "SUBSCRIPTION_EXTENDED", {
        endsAt: NEXT_PERIOD_END,
        startsAt: PERIOD_START,
      }),
    ),
  ).toMatchObject({ kind: "resolved", seatCount: 5 });
});

test("the renewal into the next period grants the smaller plan", async () => {
  const organizationId = await scheduledDowngrade();

  expect(
    await grantedSeats(
      stripeEvent(organizationId, "RENEWAL", {
        endsAt: NEXT_PERIOD_END,
        startsAt: PERIOD_END,
      }),
    ),
  ).toMatchObject({ kind: "resolved", seatCount: 1 });
});

test("capacity recomputed under the lock reflects a plan change since the read", async () => {
  const organizationId = await scheduledDowngrade();
  const event = stripeEvent(organizationId, "UNCANCELLATION", {
    endsAt: PERIOD_END,
    startsAt: PERIOD_START,
  });
  const resolution = await grantedSeats(event);
  if (resolution.kind !== "resolved") throw new Error("expected resolution");
  expect(resolution.seatCount).toBe(5);

  // More capacity was paid for this period after the event was read.
  await db
    .update(organizationBillingStripeSeats)
    .set({ appliedPaidCapacity: 10 })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(
    await lockedDurableStripeSeatCount({ event, executor: db, resolution }),
  ).toBe(10);

  // The bound Price itself changed (an upgrade): the event must be retried.
  await db
    .update(organizationBillingStripeSeats)
    .set({ priceId: "price_team_10" })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(
    await lockedDurableStripeSeatCount({ event, executor: db, resolution }),
  ).toBeNull();
});

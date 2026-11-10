import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBillingStripeSeats } from "@tearleads/api-shared/schema";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { STRIPE_WEBHOOK_ENV as STRIPE_ENV } from "../../../test/helpers/stripeWebhook";
import { resolveImmutableStripeStoreOrganizationId } from "./revenuecatStripeResolution";

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
  expiresAt: Date,
): RevenueCatWebhookEvent {
  return {
    app_user_id: `user_${organizationId}`,
    event_timestamp_ms: Date.now(),
    expiration_at_ms: expiresAt.getTime(),
    id: crypto.randomUUID(),
    original_transaction_id: `sub_${organizationId}`,
    store: "STRIPE",
    type,
  } as RevenueCatWebhookEvent;
}

test("a mid-period event keeps the capacity paid before a scheduled downgrade", async () => {
  const organizationId = await scheduledDowngrade();

  expect(
    await resolveImmutableStripeStoreOrganizationId(
      db,
      stripeEvent(organizationId, "UNCANCELLATION", PERIOD_END),
      { env: STRIPE_ENV },
    ),
  ).toMatchObject({ kind: "resolved", priceId: "price_sync", seatCount: 5 });
});

test("the renewal into the next period grants the smaller plan", async () => {
  const organizationId = await scheduledDowngrade();

  expect(
    await resolveImmutableStripeStoreOrganizationId(
      db,
      stripeEvent(organizationId, "RENEWAL", NEXT_PERIOD_END),
      { env: STRIPE_ENV },
    ),
  ).toMatchObject({ kind: "resolved", seatCount: 1 });
});

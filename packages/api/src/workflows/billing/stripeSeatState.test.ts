import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { organizationSeatPeriodKey } from "../../billing/organizationBilling";
import {
  requestOrganizationStripeSeatSync,
  runBindOrganizationStripeSeatsWorkflow,
  runRecordStripeSeatRenewalWorkflow,
  type StripeSeatBindingInput,
} from "./stripeSeatState";

const TRIAL_END = new Date("2026-07-20T00:00:00.000Z");
const OLD_START = new Date("2026-07-01T00:00:00.000Z");
const OLD_END = new Date("2026-08-01T00:00:00.000Z");
const NEW_START = OLD_END;
const NEW_END = new Date("2026-09-01T00:00:00.000Z");
const NOW = new Date("2026-08-01T00:00:01.000Z");

function trialPeriodKey(): string {
  return organizationSeatPeriodKey({
    currentPeriodEndsAt: null,
    currentPeriodStartsAt: null,
    status: "trialing",
    trialEndsAt: TRIAL_END,
  });
}

function paidPeriodKey(startsAt: Date, endsAt: Date): string {
  return organizationSeatPeriodKey({
    currentPeriodEndsAt: endsAt,
    currentPeriodStartsAt: startsAt,
    status: "active",
    trialEndsAt: null,
  });
}

function stripeBinding(input: {
  readonly organizationId: string;
  readonly quantity: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
}): StripeSeatBindingInput {
  return {
    billingPeriodEndsAt: input.endsAt,
    billingPeriodStartsAt: input.startsAt,
    customerId: "cus_seats",
    organizationId: input.organizationId,
    priceId: "price_sync",
    seatQuantity: input.quantity,
    subscriptionId: `sub_${input.organizationId}`,
    subscriptionItemId: `si_${input.organizationId}`,
  };
}

async function readStripeSeats(organizationId: string) {
  const [state] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  return state;
}

test("initial paid binding does not inherit a removed trial seat", async () => {
  const organizationId = crypto.randomUUID();
  const trialKey = trialPeriodKey();
  await db.insert(organizationBilling).values({
    organizationId,
    seatCount: 3,
    seatPeriodKey: trialKey,
    status: "trialing",
    trialEndsAt: TRIAL_END,
  });
  await db.insert(organizationBillingStripeSeats).values({
    appliedPaidCapacity: 3,
    appliedSeatPeriodKey: trialKey,
    desiredPaidCapacity: 3,
    desiredRenewalQuantity: 2,
    desiredRevision: 1,
    desiredSeatPeriodKey: trialKey,
    inFlightOperationId: "trial-operation",
    inFlightTargetCapacity: 3,
    leaseExpiresAt: new Date(NOW.getTime() + 60_000),
    leaseId: "trial-lease",
    nextAttemptAt: NOW,
    organizationId,
  });

  await runBindOrganizationStripeSeatsWorkflow(
    db,
    stripeBinding({
      endsAt: OLD_END,
      organizationId,
      quantity: 2,
      startsAt: OLD_START,
    }),
    NOW,
  );

  expect(await readStripeSeats(organizationId)).toMatchObject({
    appliedPaidCapacity: 2,
    appliedSeatPeriodKey: paidPeriodKey(OLD_START, OLD_END),
    desiredPaidCapacity: 2,
    desiredRenewalQuantity: 2,
    desiredSeatPeriodKey: paidPeriodKey(OLD_START, OLD_END),
    inFlightOperationId: null,
    leaseId: null,
  });
});

test("renewal replaces the old-period high-water with renewed quantity", async () => {
  const organizationId = crypto.randomUUID();
  const oldKey = paidPeriodKey(OLD_START, OLD_END);
  await db.insert(organizationBilling).values({
    currentPeriodEndsAt: OLD_END,
    currentPeriodStartsAt: OLD_START,
    organizationId,
    seatCount: 3,
    seatPeriodKey: oldKey,
    status: "active",
  });
  const binding = stripeBinding({
    endsAt: NEW_END,
    organizationId,
    quantity: 2,
    startsAt: NEW_START,
  });
  await db.insert(organizationBillingStripeSeats).values({
    appliedPaidCapacity: 3,
    appliedSeatPeriodKey: oldKey,
    billingPeriodEndsAt: OLD_END,
    billingPeriodStartsAt: OLD_START,
    desiredPaidCapacity: 3,
    desiredRenewalQuantity: 2,
    desiredRevision: 1,
    desiredSeatPeriodKey: oldKey,
    nextAttemptAt: NOW,
    organizationId,
    priceId: binding.priceId,
    subscriptionId: binding.subscriptionId,
    subscriptionItemId: binding.subscriptionItemId,
  });

  await runRecordStripeSeatRenewalWorkflow(
    db,
    { ...binding, invoiceId: "in_new_period" },
    NOW,
  );

  expect(await readStripeSeats(organizationId)).toMatchObject({
    appliedPaidCapacity: 2,
    appliedSeatPeriodKey: paidPeriodKey(NEW_START, NEW_END),
    desiredPaidCapacity: 2,
    desiredRenewalQuantity: 2,
    desiredSeatPeriodKey: paidPeriodKey(NEW_START, NEW_END),
    lastInvoiceId: "in_new_period",
  });
});

test("a same-period invoice cannot erase paid capacity", async () => {
  const organizationId = crypto.randomUUID();
  const periodKey = paidPeriodKey(NEW_START, NEW_END);
  await db.insert(organizationBilling).values({
    currentPeriodEndsAt: NEW_END,
    currentPeriodStartsAt: NEW_START,
    organizationId,
    seatCount: 3,
    seatPeriodKey: periodKey,
    status: "active",
  });
  const binding = stripeBinding({
    endsAt: NEW_END,
    organizationId,
    quantity: 2,
    startsAt: NEW_START,
  });
  await db.insert(organizationBillingStripeSeats).values({
    appliedPaidCapacity: 3,
    appliedSeatPeriodKey: periodKey,
    billingPeriodEndsAt: NEW_END,
    billingPeriodStartsAt: NEW_START,
    desiredPaidCapacity: 3,
    desiredRenewalQuantity: 2,
    desiredRevision: 1,
    desiredSeatPeriodKey: periodKey,
    nextAttemptAt: NOW,
    observedQuantity: 2,
    organizationId,
    priceId: binding.priceId,
    subscriptionId: binding.subscriptionId,
    subscriptionItemId: binding.subscriptionItemId,
  });

  await runRecordStripeSeatRenewalWorkflow(
    db,
    { ...binding, invoiceId: "in_delayed_same_period" },
    NOW,
  );

  expect(await readStripeSeats(organizationId)).toMatchObject({
    appliedPaidCapacity: 3,
    desiredPaidCapacity: 3,
    lastInvoiceId: "in_delayed_same_period",
  });
});

test("a delayed local period cannot roll provider seat state backward", async () => {
  const organizationId = crypto.randomUUID();
  const providerKey = paidPeriodKey(OLD_START, OLD_END);
  await db.insert(organizationBillingStripeSeats).values({
    appliedPaidCapacity: 2,
    appliedSeatPeriodKey: providerKey,
    desiredPaidCapacity: 2,
    desiredRenewalQuantity: 2,
    desiredRevision: 1,
    desiredSeatPeriodKey: providerKey,
    nextAttemptAt: NOW,
    organizationId,
    priceId: "price_sync",
    subscriptionId: `sub_${organizationId}`,
    subscriptionItemId: `si_${organizationId}`,
  });

  await requestOrganizationStripeSeatSync({
    desiredPaidCapacity: 3,
    desiredRenewalQuantity: 2,
    desiredSeatPeriodKey: trialPeriodKey(),
    executor: db,
    now: NOW,
    organizationId,
  });

  expect(await readStripeSeats(organizationId)).toMatchObject({
    desiredPaidCapacity: 2,
    desiredRenewalQuantity: 2,
    desiredSeatPeriodKey: providerKey,
  });
});

test("binding fails closed when Stripe omits its billing period", async () => {
  const organizationId = crypto.randomUUID();
  await db.insert(organizationBilling).values({
    organizationId,
    status: "active",
  });
  await expect(
    runBindOrganizationStripeSeatsWorkflow(db, {
      ...stripeBinding({
        endsAt: OLD_END,
        organizationId,
        quantity: 2,
        startsAt: OLD_START,
      }),
      billingPeriodStartsAt: null,
    }),
  ).rejects.toThrow("Stripe subscription has an invalid billing period");
  expect(await readStripeSeats(organizationId)).toBeUndefined();
});

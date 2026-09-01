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
  readonly subscriptionName?: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}): StripeSeatBindingInput {
  const subscriptionName = input.subscriptionName ?? input.organizationId;
  return {
    billingPeriodEndsAt: input.endsAt,
    billingPeriodStartsAt: input.startsAt,
    customerId: "cus_seats",
    organizationId: input.organizationId,
    priceId:
      input.quantity <= 1
        ? "price_solo"
        : input.quantity <= 5
          ? "price_team_5"
          : "price_team_10",
    seatQuantity: input.quantity,
    subscriptionId: `sub_${subscriptionName}`,
    subscriptionItemId: `si_${subscriptionName}`,
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
    seatCount: 5,
    seatPeriodKey: trialKey,
    status: "trialing",
    trialEndsAt: TRIAL_END,
  });
  await db.insert(organizationBillingStripeSeats).values({
    appliedPaidCapacity: 5,
    appliedSeatPeriodKey: trialKey,
    desiredPaidCapacity: 5,
    desiredRenewalQuantity: 1,
    desiredRevision: 1,
    desiredSeatPeriodKey: trialKey,
    inFlightOperationId: "trial-operation",
    inFlightTargetCapacity: 5,
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
      quantity: 1,
      startsAt: OLD_START,
    }),
    NOW,
  );

  expect(await readStripeSeats(organizationId)).toMatchObject({
    appliedPaidCapacity: 1,
    appliedSeatPeriodKey: paidPeriodKey(OLD_START, OLD_END),
    desiredPaidCapacity: 1,
    desiredRenewalQuantity: 1,
    desiredSeatPeriodKey: paidPeriodKey(OLD_START, OLD_END),
    inFlightOperationId: null,
    leaseId: null,
  });
});

test("renewal replaces the old-period high-water with renewed capacity", async () => {
  const organizationId = crypto.randomUUID();
  const oldKey = paidPeriodKey(OLD_START, OLD_END);
  await db.insert(organizationBilling).values({
    currentPeriodEndsAt: OLD_END,
    currentPeriodStartsAt: OLD_START,
    organizationId,
    seatCount: 5,
    seatPeriodKey: oldKey,
    status: "active",
  });
  const binding = stripeBinding({
    endsAt: NEW_END,
    organizationId,
    quantity: 1,
    startsAt: NEW_START,
  });
  await db.insert(organizationBillingStripeSeats).values({
    appliedPaidCapacity: 5,
    appliedSeatPeriodKey: oldKey,
    billingPeriodEndsAt: OLD_END,
    billingPeriodStartsAt: OLD_START,
    desiredPaidCapacity: 5,
    desiredRenewalQuantity: 1,
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
    appliedPaidCapacity: 1,
    appliedSeatPeriodKey: paidPeriodKey(NEW_START, NEW_END),
    desiredPaidCapacity: 1,
    desiredRenewalQuantity: 1,
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
    seatCount: 5,
    seatPeriodKey: periodKey,
    status: "active",
  });
  const binding = stripeBinding({
    endsAt: NEW_END,
    organizationId,
    quantity: 1,
    startsAt: NEW_START,
  });
  await db.insert(organizationBillingStripeSeats).values({
    appliedPaidCapacity: 5,
    appliedSeatPeriodKey: periodKey,
    billingPeriodEndsAt: NEW_END,
    billingPeriodStartsAt: NEW_START,
    desiredPaidCapacity: 5,
    desiredRenewalQuantity: 1,
    desiredRevision: 1,
    desiredSeatPeriodKey: periodKey,
    nextAttemptAt: NOW,
    observedQuantity: 1,
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
    appliedPaidCapacity: 5,
    desiredPaidCapacity: 5,
    lastInvoiceId: "in_delayed_same_period",
  });
});

test("a newer replacement rejects a delayed predecessor invoice", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionNameA = `${organizationId}_a`;
  const subscriptionNameB = `${organizationId}_b`;
  await db.insert(organizationBilling).values({
    currentPeriodEndsAt: OLD_END,
    currentPeriodStartsAt: OLD_START,
    organizationId,
    provider: "revenuecat",
    providerSubscriptionId: `sub_${subscriptionNameA}`,
    seatCount: 2,
    seatPeriodKey: paidPeriodKey(OLD_START, OLD_END),
    status: "active",
  });
  const bindingA = stripeBinding({
    endsAt: OLD_END,
    organizationId,
    quantity: 2,
    startsAt: OLD_START,
    subscriptionName: subscriptionNameA,
  });
  const bindingB = stripeBinding({
    endsAt: NEW_END,
    organizationId,
    quantity: 2,
    startsAt: NEW_START,
    subscriptionName: subscriptionNameB,
  });

  expect(
    await runBindOrganizationStripeSeatsWorkflow(db, bindingA, NOW),
  ).toEqual({ status: "accepted" });
  expect(
    await runBindOrganizationStripeSeatsWorkflow(db, bindingB, NOW),
  ).toEqual({ status: "accepted" });
  expect(
    await runRecordStripeSeatRenewalWorkflow(
      db,
      { ...bindingB, invoiceId: "in_b" },
      NOW,
    ),
  ).toEqual({ status: "accepted" });
  expect(
    await runRecordStripeSeatRenewalWorkflow(
      db,
      { ...bindingA, invoiceId: "in_stale_a" },
      NOW,
    ),
  ).toEqual({ status: "stale" });

  expect(await readStripeSeats(organizationId)).toMatchObject({
    appliedSeatPeriodKey: paidPeriodKey(NEW_START, NEW_END),
    lastInvoiceId: "in_b",
    subscriptionId: bindingB.subscriptionId,
    subscriptionItemId: bindingB.subscriptionItemId,
  });
});

test("a concurrent renewal cannot stamp a successor binding", async () => {
  const organizationId = crypto.randomUUID();
  const bindingA = stripeBinding({
    endsAt: OLD_END,
    organizationId,
    quantity: 2,
    startsAt: OLD_START,
    subscriptionName: `${organizationId}_race_a`,
  });
  const bindingB = stripeBinding({
    endsAt: NEW_END,
    organizationId,
    quantity: 2,
    startsAt: NEW_START,
    subscriptionName: `${organizationId}_race_b`,
  });
  await db.insert(organizationBilling).values({
    currentPeriodEndsAt: OLD_END,
    currentPeriodStartsAt: OLD_START,
    organizationId,
    provider: "revenuecat",
    providerSubscriptionId: bindingA.subscriptionId,
    seatCount: 2,
    seatPeriodKey: paidPeriodKey(OLD_START, OLD_END),
    status: "active",
  });
  await runBindOrganizationStripeSeatsWorkflow(db, bindingA, NOW);

  const start = Promise.withResolvers<void>();
  const renewal = (async () => {
    await start.promise;
    return runRecordStripeSeatRenewalWorkflow(
      db,
      { ...bindingA, invoiceId: "in_racing_a" },
      NOW,
    );
  })();
  const replacement = (async () => {
    await start.promise;
    return runBindOrganizationStripeSeatsWorkflow(db, bindingB, NOW);
  })();
  start.resolve();
  const [renewalOutcome, replacementOutcome] = await Promise.all([
    renewal,
    replacement,
  ]);

  expect(replacementOutcome).toEqual({ status: "accepted" });
  expect(["accepted", "stale"]).toContain(renewalOutcome.status);
  expect(await readStripeSeats(organizationId)).toMatchObject({
    lastInvoiceId: null,
    subscriptionId: bindingB.subscriptionId,
    subscriptionItemId: bindingB.subscriptionItemId,
  });
});

test("provider item identity tie-breaks an equal-period replacement", async () => {
  const organizationId = crypto.randomUUID();
  const subscriptionNameA = `${organizationId}_a`;
  const subscriptionNameB = `${organizationId}_b`;
  await db.insert(organizationBilling).values({
    currentPeriodEndsAt: OLD_END,
    currentPeriodStartsAt: OLD_START,
    organizationId,
    provider: "revenuecat",
    providerSubscriptionId: `si_${subscriptionNameB}`,
    seatCount: 2,
    seatPeriodKey: paidPeriodKey(OLD_START, OLD_END),
    status: "active",
  });
  const bindingA = stripeBinding({
    endsAt: OLD_END,
    organizationId,
    quantity: 2,
    startsAt: OLD_START,
    subscriptionName: subscriptionNameA,
  });
  const bindingB = stripeBinding({
    endsAt: OLD_END,
    organizationId,
    quantity: 2,
    startsAt: OLD_START,
    subscriptionName: subscriptionNameB,
  });

  // Seed the predecessor as if it predated the provider-identity update.
  await db.insert(organizationBillingStripeSeats).values({
    appliedPaidCapacity: 5,
    appliedSeatPeriodKey: paidPeriodKey(OLD_START, OLD_END),
    billingPeriodEndsAt: OLD_END,
    billingPeriodStartsAt: OLD_START,
    desiredPaidCapacity: 5,
    desiredRenewalQuantity: 5,
    desiredRevision: 1,
    desiredSeatPeriodKey: paidPeriodKey(OLD_START, OLD_END),
    nextAttemptAt: NOW,
    organizationId,
    priceId: bindingA.priceId,
    subscriptionId: bindingA.subscriptionId,
    subscriptionItemId: bindingA.subscriptionItemId,
  });

  expect(
    await runBindOrganizationStripeSeatsWorkflow(db, bindingB, NOW),
  ).toEqual({ status: "accepted" });
  expect(
    await runBindOrganizationStripeSeatsWorkflow(db, bindingA, NOW),
  ).toEqual({ status: "stale" });
  expect(await readStripeSeats(organizationId)).toMatchObject({
    subscriptionId: bindingB.subscriptionId,
    subscriptionItemId: bindingB.subscriptionItemId,
  });
});

test("a delayed local period cannot roll provider seat state backward", async () => {
  const organizationId = crypto.randomUUID();
  const providerKey = paidPeriodKey(OLD_START, OLD_END);
  await db.insert(organizationBillingStripeSeats).values({
    appliedPaidCapacity: 5,
    appliedSeatPeriodKey: providerKey,
    desiredPaidCapacity: 5,
    desiredRenewalQuantity: 5,
    desiredRevision: 1,
    desiredSeatPeriodKey: providerKey,
    nextAttemptAt: NOW,
    organizationId,
    priceId: "price_team_5",
    subscriptionId: `sub_${organizationId}`,
    subscriptionItemId: `si_${organizationId}`,
  });

  await requestOrganizationStripeSeatSync({
    desiredPaidCapacity: 1,
    desiredRenewalQuantity: 5,
    desiredSeatPeriodKey: trialPeriodKey(),
    executor: db,
    now: NOW,
    organizationId,
  });

  expect(await readStripeSeats(organizationId)).toMatchObject({
    desiredPaidCapacity: 5,
    desiredRenewalQuantity: 5,
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

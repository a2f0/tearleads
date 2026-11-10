import { randomUUID } from "node:crypto";
import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { and, asc, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
import { normalizeStripeSeatQuantity } from "../../billing/stripeSeatQuantity";
import { isSqliteApiDatabase, lockRowForUpdate } from "../../utils/sqlDialect";
import { reconcileOrganizationBillingSeats } from "./organizationSeats";
import { hasActiveStripeBinding } from "./stripeBindingPolicy";
import { isSameBillingPeriod } from "./stripePeriodMatch";

const LEASE_MS = 5 * 60 * 1000;
const DRIFT_AUDIT_MS = 24 * 60 * 60 * 1000;
/** Longest failure backoff, so a failed row is due again within this window. */
export const STRIPE_SEAT_SYNC_MAX_RETRY_MS = 60 * 60 * 1000;

export interface StripeSeatSyncClaim {
  readonly appliedSeatPeriodKey: string | null;
  readonly appliedPaidCapacity: number;
  readonly billingPeriodEndsAt: Date | null;
  readonly billingPeriodStartsAt: Date | null;
  readonly desiredPaidCapacity: number;
  readonly desiredRenewalQuantity: number;
  readonly desiredRevision: number;
  readonly inFlightOperationId: string | null;
  readonly inFlightTargetCapacity: number | null;
  readonly leaseId: string;
  readonly organizationId: string;
  readonly priceId: string;
  readonly desiredSeatPeriodKey: string | null;
  readonly subscriptionId: string;
  readonly subscriptionItemId: string;
}

type StripeSeatStateRow = typeof organizationBillingStripeSeats.$inferSelect;

function nextRetryAt(now: Date, attemptCount: number): Date {
  const delayMs = Math.min(
    STRIPE_SEAT_SYNC_MAX_RETRY_MS,
    2 ** attemptCount * 1000,
  );
  return new Date(now.getTime() + delayMs);
}

function availableSeatLease(now: Date) {
  return or(
    isNull(organizationBillingStripeSeats.leaseExpiresAt),
    lte(organizationBillingStripeSeats.leaseExpiresAt, now),
  );
}

function buildStripeSeatSyncClaim(input: {
  readonly leaseId: string;
  readonly operationId: string | null;
  readonly operationTarget: number | null;
  readonly priceId: string;
  readonly state: StripeSeatStateRow;
  readonly subscriptionId: string;
  readonly subscriptionItemId: string;
}): StripeSeatSyncClaim {
  return {
    appliedSeatPeriodKey: input.state.appliedSeatPeriodKey,
    appliedPaidCapacity: input.state.appliedPaidCapacity,
    billingPeriodEndsAt: input.state.billingPeriodEndsAt,
    billingPeriodStartsAt: input.state.billingPeriodStartsAt,
    desiredPaidCapacity: input.state.desiredPaidCapacity,
    desiredRenewalQuantity: input.state.desiredRenewalQuantity,
    desiredRevision: input.state.desiredRevision,
    inFlightOperationId: input.operationId,
    inFlightTargetCapacity: input.operationTarget,
    leaseId: input.leaseId,
    organizationId: input.state.organizationId,
    priceId: input.priceId,
    desiredSeatPeriodKey: input.state.desiredSeatPeriodKey,
    subscriptionId: input.subscriptionId,
    subscriptionItemId: input.subscriptionItemId,
  };
}

async function prepareStripeSeatOperation(
  executor: DatabaseSession,
  state: StripeSeatStateRow,
  now: Date,
): Promise<{
  readonly operationId: string | null;
  readonly operationTarget: number | null;
}> {
  let operationId = state.inFlightOperationId;
  let operationTarget = state.inFlightTargetCapacity;
  if (
    operationId === null &&
    (state.desiredPaidCapacity > state.appliedPaidCapacity ||
      state.desiredSeatPeriodKey !== state.appliedSeatPeriodKey)
  ) {
    operationId = randomUUID();
    operationTarget = state.desiredPaidCapacity;
    await executor
      .update(organizationBillingStripeSeats)
      .set({
        inFlightOperationId: operationId,
        inFlightTargetCapacity: operationTarget,
        updatedAt: now,
      })
      .where(eq(organizationBillingStripeSeats.id, state.id));
  }
  return { operationId, operationTarget };
}

/** Releases a claim after its authoritative provider period was rebound. */
export async function releaseOrganizationStripeSeatSyncClaim(input: {
  readonly claim: StripeSeatSyncClaim;
  readonly executor: DatabaseSession;
  readonly now: Date;
}): Promise<void> {
  await input.executor
    .update(organizationBillingStripeSeats)
    .set({
      leaseExpiresAt: null,
      leaseId: null,
      nextAttemptAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(
          organizationBillingStripeSeats.organizationId,
          input.claim.organizationId,
        ),
        eq(organizationBillingStripeSeats.leaseId, input.claim.leaseId),
      ),
    );
}

/**
 * The next due seat row; the claim locks it on PostgreSQL, and the idle billing
 * probe embeds it unlocked to learn whether a claim is worth starting.
 */
export function selectDueStripeSeatSync(executor: DatabaseSession, now: Date) {
  return executor
    .select({ organizationId: organizationBillingStripeSeats.organizationId })
    .from(organizationBillingStripeSeats)
    .innerJoin(
      organizationBilling,
      eq(
        organizationBilling.organizationId,
        organizationBillingStripeSeats.organizationId,
      ),
    )
    .where(
      and(
        eq(organizationBilling.status, "active"),
        isNotNull(organizationBillingStripeSeats.subscriptionId),
        isNotNull(organizationBillingStripeSeats.subscriptionItemId),
        isNotNull(organizationBillingStripeSeats.priceId),
        lte(organizationBillingStripeSeats.nextAttemptAt, now),
        availableSeatLease(now),
      ),
    )
    .orderBy(asc(organizationBillingStripeSeats.nextAttemptAt))
    .limit(1);
}

/** Claims one due row and freezes any new paid-capacity adjustment. */
export async function claimOrganizationStripeSeatSync(
  db: ApiDatabase,
  now: Date = new Date(),
): Promise<StripeSeatSyncClaim | null> {
  return db.transaction(async (tx) => {
    const availableLease = availableSeatLease(now);
    const candidateQuery = selectDueStripeSeatSync(tx, now);
    const [candidate] = isSqliteApiDatabase()
      ? await candidateQuery
      : await candidateQuery.for("update", { of: organizationBilling });
    if (!candidate) {
      return null;
    }
    const leaseId = randomUUID();
    const [leased] = await tx
      .update(organizationBillingStripeSeats)
      .set({
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        leaseId,
        updatedAt: now,
      })
      .where(
        and(
          eq(
            organizationBillingStripeSeats.organizationId,
            candidate.organizationId,
          ),
          availableLease,
        ),
      )
      .returning();
    if (
      !leased?.subscriptionId ||
      !leased.subscriptionItemId ||
      !leased.priceId
    ) {
      return null;
    }

    const { operationId, operationTarget } = await prepareStripeSeatOperation(
      tx,
      leased,
      now,
    );

    return buildStripeSeatSyncClaim({
      leaseId,
      operationId,
      operationTarget,
      priceId: leased.priceId,
      state: leased,
      subscriptionId: leased.subscriptionId,
      subscriptionItemId: leased.subscriptionItemId,
    });
  });
}

interface CompleteStripeSeatSyncInput {
  readonly appliedPaidCapacity: number;
  readonly billingPeriodEndsAt: Date | null;
  readonly billingPeriodStartsAt: Date | null;
  readonly claim: StripeSeatSyncClaim;
  /** A renewal plan found in Stripe (a recovered paid upgrade), or null. */
  readonly desiredRenewalQuantity: number | null;
  readonly now: Date;
  readonly observedQuantity: number;
  readonly priceId: string;
  readonly subscriptionItemId: string;
}

interface LockedSeatSyncBilling {
  readonly currentPeriodStartsAt: Date | null;
  readonly seatCount: number;
  readonly status: string;
}

/**
 * Records the claim's result and returns the paid capacity recorded; null
 * when the claim lost its lease.
 */
async function completeOrganizationStripeSeatSync(
  executor: DatabaseSession,
  input: CompleteStripeSeatSyncInput,
): Promise<number | null> {
  const [current] = await executor
    .select()
    .from(organizationBillingStripeSeats)
    .where(
      and(
        eq(
          organizationBillingStripeSeats.organizationId,
          input.claim.organizationId,
        ),
        eq(organizationBillingStripeSeats.leaseId, input.claim.leaseId),
      ),
    )
    .limit(1);
  if (!current) {
    return null;
  }
  // A renewal choice waits while this claim holds the row
  // (workflows/billing/stripePlanChange.ts), and roster writes keep the
  // renewal plan, so a plan recovered from Stripe replaces no newer choice.
  const renewalQuantity =
    input.desiredRenewalQuantity ?? current.desiredRenewalQuantity;
  // Paid capacity only rises within a period: an upgrade that settled while
  // this claim read Stripe already recorded more than the claim saw.
  const samePeriod =
    current.billingPeriodStartsAt !== null &&
    current.billingPeriodStartsAt.getTime() ===
      input.billingPeriodStartsAt?.getTime();
  const appliedPaidCapacity = samePeriod
    ? Math.max(current.appliedPaidCapacity, input.appliedPaidCapacity)
    : input.appliedPaidCapacity;
  // The worker never writes a renewal Price above the capacity paid for, so
  // a larger renewal plan still being paid for is not a drift to retry.
  const expectedQuantity = Math.min(
    normalizeStripeSeatQuantity(renewalQuantity),
    appliedPaidCapacity,
  );
  const fullyApplied =
    current.desiredRevision === input.claim.desiredRevision &&
    current.desiredPaidCapacity <= appliedPaidCapacity &&
    expectedQuantity === input.observedQuantity;
  await executor
    .update(organizationBillingStripeSeats)
    .set({
      appliedPaidCapacity,
      appliedRevision: fullyApplied
        ? current.desiredRevision
        : current.appliedRevision,
      attemptCount: 0,
      billingPeriodEndsAt: input.billingPeriodEndsAt,
      billingPeriodStartsAt: input.billingPeriodStartsAt,
      desiredRenewalQuantity: renewalQuantity,
      inFlightOperationId: null,
      inFlightTargetCapacity: null,
      lastError: null,
      lastSyncedAt: input.now,
      leaseExpiresAt: null,
      leaseId: null,
      nextAttemptAt: fullyApplied
        ? new Date(input.now.getTime() + DRIFT_AUDIT_MS)
        : input.now,
      observedQuantity: input.observedQuantity,
      priceId: input.priceId,
      appliedSeatPeriodKey: input.claim.desiredSeatPeriodKey,
      subscriptionItemId: input.subscriptionItemId,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(organizationBillingStripeSeats.id, current.id),
        eq(organizationBillingStripeSeats.leaseId, input.claim.leaseId),
      ),
    );
  return appliedPaidCapacity;
}

/**
 * Grants capacity Stripe was paid for in the period the organization's
 * billing tracks but that it does not license yet: an upgrade whose request
 * never finished (a lost response, a failed final transaction), so a paid
 * upgrade applies without depending on the request that started it.
 */
async function grantPaidStripeCapacity(
  executor: DatabaseSession,
  billing: LockedSeatSyncBilling | undefined,
  input: CompleteStripeSeatSyncInput,
): Promise<void> {
  const [seats] = await executor
    .select()
    .from(organizationBillingStripeSeats)
    .where(
      eq(
        organizationBillingStripeSeats.organizationId,
        input.claim.organizationId,
      ),
    )
    .limit(1);
  // RevenueCat's timestamps for the period can differ slightly from Stripe's.
  const samePeriod =
    billing?.currentPeriodStartsAt != null &&
    input.billingPeriodStartsAt !== null &&
    isSameBillingPeriod(billing.currentPeriodStartsAt, {
      endsAt: input.billingPeriodEndsAt,
      startsAt: input.billingPeriodStartsAt,
    });
  if (
    billing?.status !== "active" ||
    !samePeriod ||
    billing.seatCount >= input.appliedPaidCapacity ||
    !hasActiveStripeBinding(seats)
  ) {
    return;
  }
  await reconcileOrganizationBillingSeats({
    executor,
    licensedSeatCount: input.appliedPaidCapacity,
    now: input.now,
    organizationId: input.claim.organizationId,
    source: {
      sourceId: `stripe-seat-sync:${input.claim.leaseId}`,
      sourceType: "billing_transition",
    },
  });
}

/**
 * Records a synchronized claim and grants the paid capacity it found in one
 * transaction, under the billing row lock every seat-row writer takes first.
 * If either fails, the claim keeps its lease for failure handling to retry
 * soon, rather than being scheduled as a day-later audit.
 */
export async function runCompleteOrganizationStripeSeatSyncWorkflow(
  db: ApiDatabase,
  input: CompleteStripeSeatSyncInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [billing] = await lockRowForUpdate(
      tx
        .select({
          currentPeriodStartsAt: organizationBilling.currentPeriodStartsAt,
          seatCount: organizationBilling.seatCount,
          status: organizationBilling.status,
        })
        .from(organizationBilling)
        .where(
          eq(organizationBilling.organizationId, input.claim.organizationId),
        )
        .limit(1),
    );
    const appliedPaidCapacity = await completeOrganizationStripeSeatSync(
      tx,
      input,
    );
    if (appliedPaidCapacity !== null) {
      await grantPaidStripeCapacity(tx, billing, {
        ...input,
        appliedPaidCapacity,
      });
    }
  });
}

export async function failOrganizationStripeSeatSync(input: {
  readonly claim: StripeSeatSyncClaim;
  readonly error: string;
  readonly executor: DatabaseSession;
  readonly now: Date;
}): Promise<void> {
  const [current] = await input.executor
    .select({
      attemptCount: organizationBillingStripeSeats.attemptCount,
      id: organizationBillingStripeSeats.id,
    })
    .from(organizationBillingStripeSeats)
    .where(
      and(
        eq(
          organizationBillingStripeSeats.organizationId,
          input.claim.organizationId,
        ),
        eq(organizationBillingStripeSeats.leaseId, input.claim.leaseId),
      ),
    )
    .limit(1);
  if (!current) {
    return;
  }
  const attemptCount = current.attemptCount + 1;
  await input.executor
    .update(organizationBillingStripeSeats)
    .set({
      attemptCount,
      lastError: input.error.slice(0, 1000),
      leaseExpiresAt: null,
      leaseId: null,
      nextAttemptAt: nextRetryAt(input.now, attemptCount),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(organizationBillingStripeSeats.id, current.id),
        eq(organizationBillingStripeSeats.leaseId, input.claim.leaseId),
      ),
    );
}

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
import { isSqliteApiDatabase } from "../../utils/sqlDialect";

const LEASE_MS = 5 * 60 * 1000;
const DRIFT_AUDIT_MS = 24 * 60 * 60 * 1000;
const MAX_RETRY_MS = 60 * 60 * 1000;

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
  const delayMs = Math.min(MAX_RETRY_MS, 2 ** attemptCount * 1000);
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

/** Claims one due row and freezes any new paid-capacity adjustment. */
export async function claimOrganizationStripeSeatSync(
  db: ApiDatabase,
  now: Date = new Date(),
): Promise<StripeSeatSyncClaim | null> {
  return db.transaction(async (tx) => {
    const availableLease = availableSeatLease(now);
    const candidateQuery = tx
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
          availableLease,
        ),
      )
      .orderBy(asc(organizationBillingStripeSeats.nextAttemptAt))
      .limit(1);
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

export async function completeOrganizationStripeSeatSync(input: {
  readonly appliedPaidCapacity: number;
  readonly billingPeriodEndsAt: Date | null;
  readonly billingPeriodStartsAt: Date | null;
  readonly claim: StripeSeatSyncClaim;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly observedQuantity: number;
  readonly priceId: string;
  readonly subscriptionItemId: string;
}): Promise<void> {
  const [current] = await input.executor
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
    return;
  }
  const expectedQuantity = normalizeStripeSeatQuantity(
    current.desiredRenewalQuantity,
  );
  const fullyApplied =
    current.desiredRevision === input.claim.desiredRevision &&
    current.desiredPaidCapacity <= input.appliedPaidCapacity &&
    expectedQuantity === input.observedQuantity;
  await input.executor
    .update(organizationBillingStripeSeats)
    .set({
      appliedPaidCapacity: input.appliedPaidCapacity,
      appliedRevision: fullyApplied
        ? current.desiredRevision
        : current.appliedRevision,
      attemptCount: 0,
      billingPeriodEndsAt: input.billingPeriodEndsAt,
      billingPeriodStartsAt: input.billingPeriodStartsAt,
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

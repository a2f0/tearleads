import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingLifecycleEvents,
  organizationBillingSeatAssignments,
  organizationBillingSeatEvents,
} from "@tearleads/api-shared/schema";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { LAPSED_BILLING_PURGE_GRACE_MS } from "../../billing/organizationBilling";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";

const DEFAULT_EXPIRY_LIMIT = 100;

export function freeTrialLifecycleSourceId(
  organizationId: string,
  trialEndsAt: Date,
): string {
  return `trial:${organizationId}:${trialEndsAt.toISOString()}`;
}

/** Records the exact capacity initialized by a successful trial transition. */
export async function recordFreeTrialInitialized(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly trialEndsAt: Date;
  readonly trialStartedAt: Date;
}): Promise<void> {
  const [seatSnapshot] = await input.executor
    .select({
      activeSeatCount: organizationBillingSeatEvents.activeSeatCount,
      licensedSeatCount: organizationBillingSeatEvents.licensedSeatCount,
      quantityDelta: organizationBillingSeatEvents.quantityDelta,
    })
    .from(organizationBillingSeatEvents)
    .where(
      and(
        eq(organizationBillingSeatEvents.organizationId, input.organizationId),
        eq(organizationBillingSeatEvents.sourceType, "billing_transition"),
        eq(organizationBillingSeatEvents.sourceId, input.sourceId),
        eq(
          organizationBillingSeatEvents.eventType,
          "licensed_seat_count_initialized",
        ),
      ),
    )
    .limit(1);
  if (!seatSnapshot) {
    throw new Error("Free trial did not initialize licensed seat capacity");
  }

  await input.executor
    .insert(organizationBillingLifecycleEvents)
    .values({
      activeSeatCount: seatSnapshot.activeSeatCount,
      createdAt: input.trialStartedAt,
      eventType: "free_trial_initialized",
      licensedSeatCount: seatSnapshot.licensedSeatCount,
      occurredAt: input.trialStartedAt,
      organizationId: input.organizationId,
      periodEndsAt: input.trialEndsAt,
      periodStartsAt: input.trialStartedAt,
      quantityDelta: seatSnapshot.quantityDelta,
      sourceId: input.sourceId,
    })
    .onConflictDoNothing({
      target: [
        organizationBillingLifecycleEvents.organizationId,
        organizationBillingLifecycleEvents.eventType,
        organizationBillingLifecycleEvents.sourceId,
      ],
    });
}

interface ExpiringTrial {
  readonly seatCount: number;
  readonly trialEndsAt: Date;
}

async function loadExpiringTrial(
  executor: DatabaseSession,
  organizationId: string,
  now: Date,
): Promise<ExpiringTrial | null> {
  const query = executor
    .select({
      seatCount: organizationBilling.seatCount,
      trialEndsAt: organizationBilling.trialEndsAt,
    })
    .from(organizationBilling)
    .where(
      and(
        eq(organizationBilling.organizationId, organizationId),
        eq(organizationBilling.status, "trialing"),
        lte(organizationBilling.trialEndsAt, now),
      ),
    )
    .limit(1);
  const [billing] = isSqliteApiDatabase()
    ? await query
    : await query.for("update", { of: organizationBilling });
  return billing?.trialEndsAt
    ? { seatCount: billing.seatCount, trialEndsAt: billing.trialEndsAt }
    : null;
}

async function loadTrialPeriodStart(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly sourceId: string;
  readonly trialEndsAt: Date;
}): Promise<Date> {
  const [initialized] = await input.executor
    .select({
      periodStartsAt: organizationBillingLifecycleEvents.periodStartsAt,
    })
    .from(organizationBillingLifecycleEvents)
    .where(
      and(
        eq(
          organizationBillingLifecycleEvents.organizationId,
          input.organizationId,
        ),
        eq(
          organizationBillingLifecycleEvents.eventType,
          "free_trial_initialized",
        ),
        eq(organizationBillingLifecycleEvents.sourceId, input.sourceId),
      ),
    )
    .limit(1);
  if (!initialized) {
    throw new Error("Expired free trial has no initialization event");
  }
  return initialized.periodStartsAt;
}

async function disableTrial(input: {
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly organizationId: string;
  readonly trialEndsAt: Date;
}): Promise<boolean> {
  const purgeAfter = new Date(
    input.trialEndsAt.getTime() + LAPSED_BILLING_PURGE_GRACE_MS,
  );
  const [updated] = await input.executor
    .update(organizationBilling)
    .set({
      disabledAt: input.trialEndsAt,
      purgeAfter,
      seatCount: 0,
      seatPeriodKey: null,
      status: "disabled",
      trialEndsAt: null,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(organizationBilling.organizationId, input.organizationId),
        eq(organizationBilling.status, "trialing"),
        lte(organizationBilling.trialEndsAt, input.now),
      ),
    )
    .returning({ organizationId: organizationBilling.organizationId });
  return updated !== undefined;
}

async function releaseTrialAssignments(input: {
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly organizationId: string;
  readonly periodStartsAt: Date;
  readonly sourceId: string;
  readonly trialEndsAt: Date;
}): Promise<void> {
  const assignments = await input.executor
    .select({ userId: organizationBillingSeatAssignments.userId })
    .from(organizationBillingSeatAssignments)
    .where(
      and(
        eq(
          organizationBillingSeatAssignments.organizationId,
          input.organizationId,
        ),
        isNull(organizationBillingSeatAssignments.releasedAt),
      ),
    );
  if (assignments.length === 0) {
    return;
  }
  await input.executor
    .update(organizationBillingSeatAssignments)
    .set({
      releasedAt: input.trialEndsAt,
      releaseSourceId: input.sourceId,
      releaseSourceType: "billing_transition",
      updatedAt: input.now,
    })
    .where(
      and(
        eq(
          organizationBillingSeatAssignments.organizationId,
          input.organizationId,
        ),
        isNull(organizationBillingSeatAssignments.releasedAt),
      ),
    );
  await input.executor.insert(organizationBillingSeatEvents).values(
    assignments.map((assignment) => ({
      activeSeatCount: 0,
      billingPeriodEndsAt: input.trialEndsAt,
      billingPeriodStartsAt: input.periodStartsAt,
      createdAt: input.trialEndsAt,
      eventType: "seat_released" as const,
      licensedSeatCount: 0,
      organizationId: input.organizationId,
      quantityDelta: 0,
      sourceId: input.sourceId,
      sourceType: "billing_transition" as const,
      userId: assignment.userId,
    })),
  );
}

export async function runExpireOrganizationTrialWorkflow(
  db: ApiDatabase,
  organizationId: string,
  now: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const billing = await loadExpiringTrial(tx, organizationId, now);
    if (!billing) {
      return false;
    }
    const sourceId = freeTrialLifecycleSourceId(
      organizationId,
      billing.trialEndsAt,
    );
    const periodStartsAt = await loadTrialPeriodStart({
      executor: tx,
      organizationId,
      sourceId,
      trialEndsAt: billing.trialEndsAt,
    });
    const disabled = await disableTrial({
      executor: tx,
      now,
      organizationId,
      trialEndsAt: billing.trialEndsAt,
    });
    if (!disabled) {
      return false;
    }
    await releaseTrialAssignments({
      executor: tx,
      now,
      organizationId,
      periodStartsAt,
      sourceId,
      trialEndsAt: billing.trialEndsAt,
    });
    await tx.insert(organizationBillingLifecycleEvents).values({
      activeSeatCount: 0,
      createdAt: now,
      eventType: "free_trial_expired",
      licensedSeatCount: 0,
      occurredAt: billing.trialEndsAt,
      organizationId,
      periodEndsAt: billing.trialEndsAt,
      periodStartsAt,
      quantityDelta: -billing.seatCount,
      sourceId,
    });
    return true;
  });
}

interface ExpireOrganizationTrialsSummary {
  readonly examined: number;
  readonly expired: number;
  readonly failed: number;
}

/** Persists due trial expirations; safe to overlap because each row is locked. */
export async function runExpireOrganizationTrialsWorkflow(
  db: ApiDatabase,
  options: { readonly limit?: number; readonly now?: Date } = {},
): Promise<ExpireOrganizationTrialsSummary> {
  const limit = options.limit ?? DEFAULT_EXPIRY_LIMIT;
  const now = options.now ?? new Date();
  const candidates = await db
    .select({ organizationId: organizationBilling.organizationId })
    .from(organizationBilling)
    .where(
      and(
        eq(organizationBilling.status, "trialing"),
        lte(organizationBilling.trialEndsAt, now),
      ),
    )
    .orderBy(
      asc(organizationBilling.trialEndsAt),
      asc(organizationBilling.organizationId),
    )
    .limit(limit);

  let expired = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      if (
        await runExpireOrganizationTrialWorkflow(
          db,
          candidate.organizationId,
          now,
        )
      ) {
        expired += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(
        `Free-trial expiry failed for organization ${candidate.organizationId}:`,
        error,
      );
    }
  }
  return { examined: candidates.length, expired, failed };
}

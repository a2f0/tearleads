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
import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { LAPSED_BILLING_PURGE_GRACE_MS } from "../../billing/organizationBilling";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";

const DEFAULT_EXPIRY_LIMIT = 100;
const MAX_EXPIRY_LIMIT = 1000;
const MAX_EXPIRY_RETRY_MS = 60 * 60 * 1000;
const EXPIRY_RETRY_BASE_MS = 60 * 1000;
const MAX_EXPIRY_RETRY_EXPONENT = 6;
const TRIAL_EXPIRY_ATTENTION_ATTEMPTS = 8;

function nextExpiryRetryAt(now: Date, attemptCount: number): Date {
  const exponent = Math.min(
    Math.max(attemptCount - 1, 0),
    MAX_EXPIRY_RETRY_EXPONENT,
  );
  const delayMs = Math.min(
    MAX_EXPIRY_RETRY_MS,
    2 ** exponent * EXPIRY_RETRY_BASE_MS,
  );
  return new Date(now.getTime() + delayMs);
}

function expiryErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    1000,
  );
}

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

async function loadTrialPeriod(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<{ readonly sourceId: string; readonly startsAt: Date }> {
  const [initialized] = await input.executor
    .select({
      periodStartsAt: organizationBillingLifecycleEvents.periodStartsAt,
      sourceId: organizationBillingLifecycleEvents.sourceId,
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
      ),
    )
    .orderBy(
      desc(organizationBillingLifecycleEvents.occurredAt),
      desc(organizationBillingLifecycleEvents.createdAt),
    )
    .limit(1);
  if (!initialized) {
    throw new Error("Expired free trial has no initialization event");
  }
  return {
    sourceId: initialized.sourceId,
    startsAt: initialized.periodStartsAt,
  };
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
      trialExpiryAttemptCount: 0,
      trialExpiryLastError: null,
      trialExpiryNextAttemptAt: null,
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
  readonly licensedSeatCount: number;
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
  if (assignments.length > 0) {
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
  }
  await input.executor.insert(organizationBillingSeatEvents).values([
    {
      activeSeatCount: 0,
      billingPeriodEndsAt: input.trialEndsAt,
      billingPeriodStartsAt: input.periodStartsAt,
      createdAt: input.now,
      eventType: "licensed_seat_count_reset",
      licensedSeatCount: 0,
      organizationId: input.organizationId,
      quantityDelta: -input.licensedSeatCount,
      sourceId: input.sourceId,
      sourceType: "billing_transition",
    },
    ...assignments.map((assignment) => ({
      activeSeatCount: 0,
      billingPeriodEndsAt: input.trialEndsAt,
      billingPeriodStartsAt: input.periodStartsAt,
      createdAt: input.now,
      eventType: "seat_released" as const,
      licensedSeatCount: 0,
      organizationId: input.organizationId,
      quantityDelta: 0,
      sourceId: input.sourceId,
      sourceType: "billing_transition" as const,
      userId: assignment.userId,
    })),
  ]);
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
    const period = await loadTrialPeriod({
      executor: tx,
      organizationId,
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
      licensedSeatCount: billing.seatCount,
      now,
      organizationId,
      periodStartsAt: period.startsAt,
      sourceId: period.sourceId,
      trialEndsAt: billing.trialEndsAt,
    });
    await tx
      .insert(organizationBillingLifecycleEvents)
      .values({
        activeSeatCount: 0,
        createdAt: now,
        eventType: "free_trial_expired",
        licensedSeatCount: 0,
        occurredAt: billing.trialEndsAt,
        organizationId,
        periodEndsAt: billing.trialEndsAt,
        periodStartsAt: period.startsAt,
        quantityDelta: -billing.seatCount,
        sourceId: period.sourceId,
      })
      .onConflictDoNothing({
        target: [
          organizationBillingLifecycleEvents.organizationId,
          organizationBillingLifecycleEvents.eventType,
          organizationBillingLifecycleEvents.sourceId,
        ],
      });
    return true;
  });
}

export interface ExpireOrganizationTrialsSummary {
  readonly attentionRequired: number;
  readonly examined: number;
  readonly expired: number;
  readonly failed: number;
}

async function deferFailedTrialExpiry(input: {
  readonly db: ApiDatabase;
  readonly error: unknown;
  readonly now: Date;
  readonly organizationId: string;
}): Promise<number | null> {
  return input.db.transaction(async (tx) => {
    const query = tx
      .select({
        attemptCount: organizationBilling.trialExpiryAttemptCount,
        trialEndsAt: organizationBilling.trialEndsAt,
      })
      .from(organizationBilling)
      .where(
        and(
          eq(organizationBilling.organizationId, input.organizationId),
          eq(organizationBilling.status, "trialing"),
          lte(organizationBilling.trialEndsAt, input.now),
          or(
            isNull(organizationBilling.trialExpiryNextAttemptAt),
            lte(organizationBilling.trialExpiryNextAttemptAt, input.now),
          ),
        ),
      )
      .limit(1);
    const [current] = isSqliteApiDatabase()
      ? await query
      : await query.for("update", { of: organizationBilling });
    if (!current?.trialEndsAt) {
      return null;
    }
    const attemptCount = current.attemptCount + 1;
    await tx
      .update(organizationBilling)
      .set({
        trialExpiryAttemptCount: attemptCount,
        trialExpiryLastError: expiryErrorMessage(input.error),
        trialExpiryNextAttemptAt: nextExpiryRetryAt(input.now, attemptCount),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(organizationBilling.organizationId, input.organizationId),
          eq(organizationBilling.status, "trialing"),
          eq(organizationBilling.trialEndsAt, current.trialEndsAt),
          or(
            isNull(organizationBilling.trialExpiryNextAttemptAt),
            lte(organizationBilling.trialExpiryNextAttemptAt, input.now),
          ),
        ),
      );
    return attemptCount;
  });
}

/**
 * Persists due trial expirations. Conditional updates make overlapping sweeps
 * safe on every database; PostgreSQL additionally locks each selected row.
 */
export async function runExpireOrganizationTrialsWorkflow(
  db: ApiDatabase,
  options: ExpireOrganizationTrialsOptions = {},
): Promise<ExpireOrganizationTrialsSummary> {
  const limit = Math.min(
    MAX_EXPIRY_LIMIT,
    Math.floor(options.limit ?? DEFAULT_EXPIRY_LIMIT),
  );
  const now = options.now ?? new Date();
  if (
    !Number.isFinite(limit) ||
    limit <= 0 ||
    options.organizationIds?.length === 0
  ) {
    return { attentionRequired: 0, examined: 0, expired: 0, failed: 0 };
  }
  const candidates = await db
    .select({ organizationId: organizationBilling.organizationId })
    .from(organizationBilling)
    .where(
      and(
        eq(organizationBilling.status, "trialing"),
        lte(organizationBilling.trialEndsAt, now),
        or(
          isNull(organizationBilling.trialExpiryNextAttemptAt),
          lte(organizationBilling.trialExpiryNextAttemptAt, now),
        ),
        options.organizationIds
          ? inArray(organizationBilling.organizationId, options.organizationIds)
          : undefined,
      ),
    )
    .orderBy(
      asc(organizationBilling.trialEndsAt),
      asc(organizationBilling.organizationId),
    )
    .limit(limit);

  let expired = 0;
  let failed = 0;
  let attentionRequired = 0;
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
      let attemptCount: number | null = null;
      try {
        attemptCount = await deferFailedTrialExpiry({
          db,
          error,
          now,
          organizationId: candidate.organizationId,
        });
      } catch (deferError) {
        console.error(
          `Free-trial expiry backoff failed for organization ${candidate.organizationId}:`,
          deferError,
        );
      }
      if (
        attemptCount !== null &&
        attemptCount >= TRIAL_EXPIRY_ATTENTION_ATTEMPTS
      ) {
        attentionRequired += 1;
        console.error(
          `Free-trial expiry requires operator attention for organization ${candidate.organizationId} after ${attemptCount} attempts`,
        );
      }
      console.error(
        `Free-trial expiry failed for organization ${candidate.organizationId}:`,
        error,
      );
    }
  }
  return { attentionRequired, examined: candidates.length, expired, failed };
}

export interface ExpireOrganizationTrialsOptions {
  readonly limit?: number;
  readonly now?: Date;
  /** Optional target set for bounded operational recovery and deterministic tests. */
  readonly organizationIds?: readonly string[];
}

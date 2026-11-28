import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  documents,
  documentUpdates,
  organizationBilling,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import {
  ROOT_OPS_HEALTH_OVERDUE_MINUTES,
  ROOT_OPS_HEALTH_SECTION_LIMIT,
  ROOT_OPS_HEALTH_UPCOMING_DAYS,
  type RootOpsHealthReportResponse,
} from "@tearleads/validators/response";
import { and, asc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ORGANIZATION_PURGE_CLAIM_LEASE_MS } from "../billing/organizationPurgeCandidates";
import { TRIAL_EXPIRY_ATTENTION_ATTEMPTS } from "../billing/organizationTrialLifecycle";
import { STRIPE_SEAT_SYNC_MAX_RETRY_MS } from "../billing/stripeSeatSyncClaim";

type Report = RootOpsHealthReportResponse;
type SeatSyncCondition =
  Report["seatSync"]["rows"][number]["conditions"][number];

const MAINTENANCE_OVERDUE_MS = ROOT_OPS_HEALTH_OVERDUE_MINUTES * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const seats = organizationBillingStripeSeats;
const billing = organizationBilling;

function section<Row>(rows: readonly Row[]) {
  return {
    rows: rows.slice(0, ROOT_OPS_HEALTH_SECTION_LIMIT),
    truncated: rows.length > ROOT_OPS_HEALTH_SECTION_LIMIT,
  };
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function shifted(now: Date, deltaMs: number): Date {
  return new Date(now.getTime() + deltaMs);
}

/**
 * Seat-sync rows the worker would claim (an active organization with a bound
 * Stripe subscription item and price) that failed, are overdue and not being
 * worked, or hold a lapsed lease.
 */
async function listSeatSyncIssues(executor: DatabaseSession, now: Date) {
  const overdueBefore = shifted(now, -MAINTENANCE_OVERDUE_MS);
  // A claim keeps the row's past retry time, so only an unleased (or lapsed)
  // overdue row is stalled; this mirrors the worker's own lease check.
  const unleased = or(
    isNull(seats.leaseExpiresAt),
    lte(seats.leaseExpiresAt, now),
  );
  const rows = await executor
    .select({
      appliedRevision: seats.appliedRevision,
      attemptCount: seats.attemptCount,
      desiredRevision: seats.desiredRevision,
      lastError: seats.lastError,
      lastSyncedAt: seats.lastSyncedAt,
      leaseExpiresAt: seats.leaseExpiresAt,
      leaseId: seats.leaseId,
      nextAttemptAt: seats.nextAttemptAt,
      organizationId: seats.organizationId,
    })
    .from(seats)
    .innerJoin(billing, eq(billing.organizationId, seats.organizationId))
    .where(
      and(
        eq(billing.status, "active"),
        isNotNull(seats.subscriptionId),
        isNotNull(seats.subscriptionItemId),
        isNotNull(seats.priceId),
        // Every condition below implies this bound: a claim needs a due row,
        // and a failure backs off by at most the maximum retry. It lets the
        // due index serve the scan instead of every bound row.
        lte(seats.nextAttemptAt, shifted(now, STRIPE_SEAT_SYNC_MAX_RETRY_MS)),
        or(
          isNotNull(seats.lastError),
          and(lte(seats.nextAttemptAt, overdueBefore), unleased),
          and(isNotNull(seats.leaseId), lte(seats.leaseExpiresAt, now)),
        ),
      ),
    )
    .orderBy(asc(seats.nextAttemptAt), asc(seats.organizationId))
    .limit(ROOT_OPS_HEALTH_SECTION_LIMIT + 1);
  return section(
    rows.map((row) => {
      const conditions: SeatSyncCondition[] = [];
      const leaseLive = row.leaseExpiresAt !== null && row.leaseExpiresAt > now;
      if (row.lastError !== null) conditions.push("failing");
      if (
        row.nextAttemptAt !== null &&
        row.nextAttemptAt <= overdueBefore &&
        !leaseLive
      )
        conditions.push("stalled");
      if (row.leaseId !== null && row.leaseExpiresAt !== null && !leaseLive)
        conditions.push("leaseExpired");
      return {
        appliedRevision: row.appliedRevision,
        attemptCount: row.attemptCount,
        conditions,
        desiredRevision: row.desiredRevision,
        lastError: row.lastError,
        lastSyncedAt: iso(row.lastSyncedAt),
        leaseExpiresAt: iso(row.leaseExpiresAt),
        nextAttemptAt: iso(row.nextAttemptAt),
        organizationId: row.organizationId,
      };
    }),
  );
}

/** Ended trials the expiry sweep has failed on, or has not reached in time. */
async function listTrialExpiryIssues(executor: DatabaseSession, now: Date) {
  const rows = await executor
    .select({
      attemptCount: billing.trialExpiryAttemptCount,
      lastError: billing.trialExpiryLastError,
      nextAttemptAt: billing.trialExpiryNextAttemptAt,
      organizationId: billing.organizationId,
      trialEndsAt: billing.trialEndsAt,
    })
    .from(billing)
    .where(
      and(
        eq(billing.status, "trialing"),
        lte(billing.trialEndsAt, now),
        or(
          gt(billing.trialExpiryAttemptCount, 0),
          lte(billing.trialEndsAt, shifted(now, -MAINTENANCE_OVERDUE_MS)),
        ),
      ),
    )
    .orderBy(asc(billing.trialEndsAt), asc(billing.organizationId))
    .limit(ROOT_OPS_HEALTH_SECTION_LIMIT + 1);
  return section(
    rows.flatMap(({ trialEndsAt, ...row }) =>
      trialEndsAt
        ? [
            {
              ...row,
              nextAttemptAt: iso(row.nextAttemptAt),
              requiresAttention:
                row.attemptCount >= TRIAL_EXPIRY_ATTENTION_ATTEMPTS,
              trialEndsAt: trialEndsAt.toISOString(),
            },
          ]
        : [],
    ),
  );
}

/**
 * Disabled organizations whose purge is overdue to start, and purges whose
 * claim lapsed: the same rows the purge job would claim, less the grace a
 * per-minute job needs to reach a newly due one.
 */
async function listPurgeIssues(executor: DatabaseSession, now: Date) {
  const rows = await executor
    .select({
      organizationId: billing.organizationId,
      purgeAfter: billing.purgeAfter,
      purgeStartedAt: billing.purgeStartedAt,
      status: billing.status,
    })
    .from(billing)
    .where(
      or(
        and(
          eq(billing.status, "disabled"),
          lte(billing.purgeAfter, shifted(now, -MAINTENANCE_OVERDUE_MS)),
        ),
        and(
          eq(billing.status, "deleting"),
          or(
            isNull(billing.purgeStartedAt),
            lte(
              billing.purgeStartedAt,
              shifted(now, -ORGANIZATION_PURGE_CLAIM_LEASE_MS),
            ),
          ),
        ),
      ),
    )
    .orderBy(
      asc(billing.purgeAfter),
      asc(billing.purgeStartedAt),
      asc(billing.organizationId),
    )
    .limit(ROOT_OPS_HEALTH_SECTION_LIMIT + 1);
  return section(
    rows.flatMap(({ status, ...row }) =>
      status === "disabled" || status === "deleting"
        ? [
            {
              organizationId: row.organizationId,
              purgeAfter: iso(row.purgeAfter),
              purgeStartedAt: iso(row.purgeStartedAt),
              status,
            },
          ]
        : [],
    ),
  );
}

async function listTrialsEnding(executor: DatabaseSession, now: Date) {
  const rows = await executor
    .select({
      organizationId: billing.organizationId,
      trialEndsAt: billing.trialEndsAt,
    })
    .from(billing)
    .where(
      and(
        eq(billing.status, "trialing"),
        gt(billing.trialEndsAt, now),
        lte(
          billing.trialEndsAt,
          shifted(now, ROOT_OPS_HEALTH_UPCOMING_DAYS * DAY_MS),
        ),
      ),
    )
    .orderBy(asc(billing.trialEndsAt), asc(billing.organizationId))
    .limit(ROOT_OPS_HEALTH_SECTION_LIMIT + 1);
  return section(
    rows.flatMap(({ organizationId, trialEndsAt }) =>
      trialEndsAt
        ? [{ organizationId, trialEndsAt: trialEndsAt.toISOString() }]
        : [],
    ),
  );
}

async function listPurgesDue(executor: DatabaseSession, now: Date) {
  const rows = await executor
    .select({
      disabledAt: billing.disabledAt,
      organizationId: billing.organizationId,
      purgeAfter: billing.purgeAfter,
    })
    .from(billing)
    .where(
      and(
        eq(billing.status, "disabled"),
        gt(billing.purgeAfter, now),
        lte(
          billing.purgeAfter,
          shifted(now, ROOT_OPS_HEALTH_UPCOMING_DAYS * DAY_MS),
        ),
      ),
    )
    .orderBy(asc(billing.purgeAfter), asc(billing.organizationId))
    .limit(ROOT_OPS_HEALTH_SECTION_LIMIT + 1);
  return section(
    rows.flatMap(({ disabledAt, organizationId, purgeAfter }) =>
      purgeAfter
        ? [
            {
              disabledAt: iso(disabledAt),
              organizationId,
              purgeAfter: purgeAfter.toISOString(),
            },
          ]
        : [],
    ),
  );
}

const triggerEnabledRowSchema = z.object({
  enabled: z.string(),
});

/**
 * Bounds synchronous drift verification to the most recently updated documents
 * via `documents_updated_at_id_idx` + per-document indexed counts on
 * `document_updates_document_sequence_idx`, keeping `ops-health` fast at scale.
 */
const DOCUMENT_UPDATE_COUNT_SCAN_LIMIT = 1_000;

const documentUpdateCountDriftRowSchema = z.object({
  actualCount: z.number().int().nonnegative(),
  documentId: z.string().min(1),
  storedCount: z.number().int(),
});

async function listDocumentUpdateCountHealth(executor: DatabaseSession) {
  const triggerResult = await executor.execute(sql`
    SELECT t.tgenabled AS enabled
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'document_updates'
      AND t.tgname = 'count_document_updates'
      AND NOT t.tgisinternal
    LIMIT 1
  `);
  const parsedTrigger = triggerEnabledRowSchema.safeParse(
    triggerResult.rows[0],
  );
  const triggerPresent =
    parsedTrigger.success &&
    (parsedTrigger.data.enabled === "O" || parsedTrigger.data.enabled === "A");

  const driftResult = await executor.execute(sql`
    WITH recent_documents AS (
      SELECT d.id, d.update_count
      FROM ${documents} d
      ORDER BY d.updated_at DESC, d.id DESC
      LIMIT ${DOCUMENT_UPDATE_COUNT_SCAN_LIMIT}
    )
    SELECT
      d.id::text AS "documentId",
      d.update_count::int AS "storedCount",
      actual.actual_count AS "actualCount"
    FROM recent_documents d
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS actual_count
      FROM ${documentUpdates} u
      WHERE u.document_id = d.id
    ) actual
    WHERE d.update_count <> actual.actual_count
    ORDER BY d.id ASC
    LIMIT ${ROOT_OPS_HEALTH_SECTION_LIMIT + 1}
  `);
  const rows = driftResult.rows.map((row) =>
    documentUpdateCountDriftRowSchema.parse(row),
  );
  return {
    triggerPresent,
    ...section(rows),
  };
}

/**
 * Cross-organization billing and storage maintenance health. PostgreSQL reads
 * every section from one repeatable-read snapshot, so an organization moving
 * between states mid-report appears in at most one and document update counts
 * match stored updates from the same snapshot.
 */
export async function loadRootOpsHealthReport(
  db: ApiDatabase,
  now: Date,
): Promise<Report> {
  return db.transaction(
    async (tx) => ({
      generatedAt: now.toISOString(),
      seatSync: await listSeatSyncIssues(tx, now),
      trialExpiry: await listTrialExpiryIssues(tx, now),
      purges: await listPurgeIssues(tx, now),
      trialsEnding: await listTrialsEnding(tx, now),
      purgesDue: await listPurgesDue(tx, now),
      documentUpdateCounts: await listDocumentUpdateCountHealth(tx),
    }),
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
}

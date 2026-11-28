import { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  safeIntegerSchema,
} from "../schema";

/** Rows each ops-health section returns at most; `truncated` marks more. */
export const ROOT_OPS_HEALTH_SECTION_LIMIT = 50;

/**
 * Billing maintenance runs every minute, so work still due this long after it
 * fell due means the job is not keeping up rather than about to reach it.
 */
export const ROOT_OPS_HEALTH_OVERDUE_MINUTES = 15;

/** How far ahead the report looks for trials ending and purges coming due. */
export const ROOT_OPS_HEALTH_UPCOMING_DAYS = 7;

function sectionSchema<RowSchema extends z.ZodType>(rowSchema: RowSchema) {
  return loosePlainObject({
    rows: arraySchema(rowSchema, ROOT_OPS_HEALTH_SECTION_LIMIT),
    /** More rows matched than the section returns. */
    truncated: z.boolean(),
  });
}

export const ROOT_SEAT_SYNC_CONDITIONS = [
  "failing",
  "stalled",
  "leaseExpired",
] as const;

/**
 * Why a Stripe seat-sync row is listed: its last attempt failed, a pending
 * change has waited well past its retry time, or a claim's lease expired
 * without the claim completing or failing.
 */
export const RootSeatSyncConditionSchema = z.literal(ROOT_SEAT_SYNC_CONDITIONS);

const RootSeatSyncIssueSchema = loosePlainObject({
  organizationId: nonEmptyStringSchema,
  conditions: arraySchema(
    RootSeatSyncConditionSchema,
    ROOT_SEAT_SYNC_CONDITIONS.length,
  ),
  attemptCount: nonNegativeIntegerSchema,
  appliedRevision: nonNegativeIntegerSchema,
  desiredRevision: nonNegativeIntegerSchema,
  lastError: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  leaseExpiresAt: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
});

const RootTrialExpiryIssueSchema = loosePlainObject({
  organizationId: nonEmptyStringSchema,
  trialEndsAt: z.string(),
  attemptCount: nonNegativeIntegerSchema,
  lastError: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
  /** The sweep has failed often enough to report the organization. */
  requiresAttention: z.boolean(),
});

const RootPurgeIssueSchema = loosePlainObject({
  organizationId: nonEmptyStringSchema,
  status: z.literal(["disabled", "deleting"]),
  purgeAfter: z.string().nullable(),
  purgeStartedAt: z.string().nullable(),
});

const RootTrialEndingSchema = loosePlainObject({
  organizationId: nonEmptyStringSchema,
  trialEndsAt: z.string(),
});

const RootPurgeDueSchema = loosePlainObject({
  organizationId: nonEmptyStringSchema,
  disabledAt: z.string().nullable(),
  purgeAfter: z.string(),
});

const RootDocumentUpdateCountDriftSchema = loosePlainObject({
  documentId: nonEmptyStringSchema,
  storedCount: safeIntegerSchema,
  actualCount: nonNegativeIntegerSchema,
});

const RootDocumentUpdateCountsHealthSchema = loosePlainObject({
  /** Whether the `count_document_updates` trigger is present and enabled. */
  triggerPresent: z.boolean(),
  rows: arraySchema(
    RootDocumentUpdateCountDriftSchema,
    ROOT_OPS_HEALTH_SECTION_LIMIT,
  ),
  /** More drifted document rows matched than the section returns. */
  truncated: z.boolean(),
});

/** Cross-organization billing and storage maintenance health, from `GET /root/reports/ops-health`. */
export const RootOpsHealthReportResponseSchema = loosePlainObject({
  generatedAt: z.string(),
  /** Stripe seat-sync rows the worker would claim, in retry order. */
  seatSync: sectionSchema(RootSeatSyncIssueSchema),
  /** Ended trials the expiry sweep failed on or has not reached in time. */
  trialExpiry: sectionSchema(RootTrialExpiryIssueSchema),
  /** Purges past due to start, or started with a lapsed lease. */
  purges: sectionSchema(RootPurgeIssueSchema),
  /** Trials ending within the upcoming window, soonest first. */
  trialsEnding: sectionSchema(RootTrialEndingSchema),
  /** Disabled organizations whose purge falls due within the window. */
  purgesDue: sectionSchema(RootPurgeDueSchema),
  /** Documents whose `update_count` disagrees with `document_updates`, plus trigger status. */
  documentUpdateCounts: RootDocumentUpdateCountsHealthSchema,
});

export type RootOpsHealthReportResponse = z.infer<
  typeof RootOpsHealthReportResponseSchema
>;

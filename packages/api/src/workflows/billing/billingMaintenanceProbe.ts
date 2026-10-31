import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { sql } from "drizzle-orm";
import {
  normalizeOrganizationPurgeLimit,
  selectOrganizationPurgeCandidates,
} from "./organizationPurgeCandidates";
import {
  normalizeTrialExpiryLimit,
  selectDueOrganizationTrials,
} from "./organizationTrialCandidates";
import { selectDueStripeSeatSync } from "./stripeSeatSyncClaim";

type BillingWorkKind = "purge" | "seat" | "trial";

/** What the per-minute billing pass has to do, read in one statement. */
export interface BillingMaintenanceProbe {
  /** The purge phase's candidates, as `listOrganizationPurgeCandidates` reads them. */
  readonly purgeOrganizationIds: readonly string[];
  /** Whether a Stripe seat row is due; the claim itself re-selects and locks it. */
  readonly seatSyncDue: boolean;
  /** The trial phase's candidates, as `selectDueOrganizationTrials` reads them. */
  readonly trialOrganizationIds: readonly string[];
}

/**
 * The three phases' own candidate selects, each with its default limit and
 * order, as derived tables of one `UNION ALL`. The seat leg is read without
 * the claim's row lock; the claim runs only when it returns a row.
 */
export async function probeBillingMaintenance(
  executor: DatabaseSession,
  now: Date,
): Promise<BillingMaintenanceProbe> {
  const trials = selectDueOrganizationTrials(executor, {
    limit: normalizeTrialExpiryLimit(undefined),
    now,
  }).as("due_trials");
  const purges = selectOrganizationPurgeCandidates(executor, {
    limit: normalizeOrganizationPurgeLimit(undefined),
    now,
  }).as("due_purges");
  const seats = selectDueStripeSeatSync(executor, now).as("due_seats");
  const rows = await executor
    .select({
      kind: sql<BillingWorkKind>`'trial'`.as("kind"),
      organizationId: trials.organizationId,
    })
    .from(trials)
    .unionAll(
      executor
        .select({
          kind: sql<BillingWorkKind>`'purge'`.as("kind"),
          organizationId: purges.organizationId,
        })
        .from(purges),
    )
    .unionAll(
      executor
        .select({
          kind: sql<BillingWorkKind>`'seat'`.as("kind"),
          organizationId: seats.organizationId,
        })
        .from(seats),
    );
  return {
    purgeOrganizationIds: rows
      .filter((row) => row.kind === "purge")
      .map((row) => row.organizationId),
    seatSyncDue: rows.some((row) => row.kind === "seat"),
    trialOrganizationIds: rows
      .filter((row) => row.kind === "trial")
      .map((row) => row.organizationId),
  };
}

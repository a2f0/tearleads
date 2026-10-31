import type { ApiDiagnosticOperation } from "@tearleads/diagnostics/server";
import {
  type BillingMaintenanceProbe,
  probeBillingMaintenance,
} from "../../workflows/billing/billingMaintenanceProbe";
import type { ApiServiceRuntime } from "../runtime";
import { runOrganizationPurgeMaintenance } from "./organizationPurge";
import { expireOrganizationTrials } from "./organizationTrialExpiry";
import { runStripeSeatSynchronization } from "./stripeSeatSync";

interface BillingMaintenancePhase {
  readonly name: string;
  readonly operation: ApiDiagnosticOperation;
  readonly run: () => Promise<unknown>;
}

type ReportFailure = (
  error: unknown,
  operation: ApiDiagnosticOperation,
) => void;

// The summaries each phase returns when it finds nothing to do.
const IDLE_TRIAL_EXPIRY = {
  attentionRequired: 0,
  examined: 0,
  expired: 0,
  failed: 0,
} as const;
const IDLE_ORGANIZATION_PURGE = { claimed: 0, failed: 0, purged: 0 } as const;
const IDLE_STRIPE_SEAT_SYNC = { attempted: 0, failed: 0, synced: 0 } as const;

async function probeOrFallBack(
  runtime: ApiServiceRuntime,
  now: Date,
  report: ReportFailure,
): Promise<BillingMaintenanceProbe | undefined> {
  try {
    return await probeBillingMaintenance(runtime.db, now);
  } catch (error) {
    // Without the probe every phase runs its own select, as before it existed,
    // so one phase's failure still cannot skip the others.
    console.error("Billing maintenance probe failed:", error);
    report(error, "billing.maintenance");
    return undefined;
  }
}

/**
 * The per-minute billing pass. One probe statement reads all three phases'
 * candidates, so an idle pass is that statement alone; a phase with work runs
 * as it always has. The trial phase consumes the probe's rows, and the purge
 * phase re-selects only when a trial expired, keeping a same-pass purge.
 */
export async function billingMaintenancePhases(
  runtime: ApiServiceRuntime,
  report: ReportFailure,
  now: Date = new Date(),
): Promise<readonly BillingMaintenancePhase[]> {
  const probe = await probeOrFallBack(runtime, now, report);
  // Unknown until the trial phase returns, which the purge phase reads.
  let expiredTrials: number | undefined;
  return [
    {
      name: "trialExpiry",
      operation: "billing.trial-expiry",
      run: async () => {
        if (probe?.trialOrganizationIds.length === 0) {
          expiredTrials = 0;
          return IDLE_TRIAL_EXPIRY;
        }
        const summary = await expireOrganizationTrials(
          runtime,
          probe ? { dueOrganizationIds: probe.trialOrganizationIds, now } : {},
        );
        expiredTrials = summary.expired;
        return summary;
      },
    },
    {
      name: "organizationPurge",
      operation: "billing.purge",
      run: async () => {
        if (!probe || expiredTrials !== 0) {
          return runOrganizationPurgeMaintenance(runtime, {});
        }
        if (probe.purgeOrganizationIds.length === 0) {
          return IDLE_ORGANIZATION_PURGE;
        }
        // Each claim re-checks its row at the phase's own, later clock.
        return runOrganizationPurgeMaintenance(runtime, {
          organizationIds: probe.purgeOrganizationIds,
        });
      },
    },
    {
      name: "stripeSeatSync",
      operation: "billing.seat-sync",
      run: async () =>
        probe && !probe.seatSyncDue
          ? IDLE_STRIPE_SEAT_SYNC
          : runStripeSeatSynchronization(runtime, {}),
    },
  ];
}

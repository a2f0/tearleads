import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import { flushApiDiagnostics } from "../diagnostics/sentry";
import { billingMaintenancePhases } from "../services/billing/billingMaintenance";
import { runBlobMaintenance } from "../services/blobs/blobMaintenance";
import { runDocumentBaselineStageMaintenance } from "../services/documents/documentBaselineStages";
import { getDefaultApiServiceRuntime } from "../services/runtime";
import { withHealthcheck } from "./healthchecks";
import {
  type MaintenancePhase,
  runMaintenancePhases,
} from "./maintenancePhases";

/** Cron expressions registered in `wrangler.jsonc`, matched by `scheduled`. */
const BILLING_MAINTENANCE_CRON = "* * * * *";
const BLOB_MAINTENANCE_CRON = "0 * * * *";
const blobGcHealthcheckUrlEnvKey = "BLOB_GC_HEALTHCHECK_URL";

/**
 * The hourly phases. Blob garbage collection runs with its Healthchecks
 * start, success, and failure pings; the sweep of expired rotation baseline
 * stages is its own phase, so a failure of one never skips the other.
 */
function hourlyPhases(): readonly MaintenancePhase[] {
  return [
    {
      name: "documentBaselineStageCleanup",
      operation: "document.maintenance",
      run: () =>
        runDocumentBaselineStageMaintenance(getDefaultApiServiceRuntime()),
    },
    {
      name: "blobGarbageCollection",
      operation: "blob.maintenance",
      run: () =>
        withHealthcheck(process.env[blobGcHealthcheckUrlEnvKey], () =>
          runBlobMaintenance(getDefaultApiServiceRuntime(), {
            dereferencedBlobs: {},
            expiredStages: {},
          }),
        ),
    },
  ];
}

/** Rejects when any phase failed, so the Cron run is recorded as failed. */
export async function runScheduledMaintenance(cron: string): Promise<void> {
  try {
    if (cron === BLOB_MAINTENANCE_CRON) {
      await runMaintenancePhases(hourlyPhases(), reportBackgroundFailure);
    } else if (cron === BILLING_MAINTENANCE_CRON) {
      // Billing maintenance, run every minute.
      await runMaintenancePhases(
        await billingMaintenancePhases(
          getDefaultApiServiceRuntime(),
          reportBackgroundFailure,
        ),
        reportBackgroundFailure,
      );
    } else {
      throw new Error(`Unknown maintenance schedule: ${cron}`);
    }
  } finally {
    await flushApiDiagnostics();
  }
}

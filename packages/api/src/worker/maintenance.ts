import type { ApiDiagnosticOperation } from "@tearleads/diagnostics/server";
import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import { flushApiDiagnostics } from "../diagnostics/sentry";
import { runOrganizationPurgeMaintenance } from "../services/billing/organizationPurge";
import { expireOrganizationTrials } from "../services/billing/organizationTrialExpiry";
import { runStripeSeatSynchronization } from "../services/billing/stripeSeatSync";
import { runBlobMaintenance } from "../services/blobs/blobMaintenance";
import { getDefaultApiServiceRuntime } from "../services/runtime";

/** Cron expressions registered in `wrangler.jsonc`, matched by `scheduled`. */
const BILLING_MAINTENANCE_CRON = "* * * * *";
const BLOB_MAINTENANCE_CRON = "0 * * * *";

async function runPhase<T>(
  name: string,
  run: () => Promise<T>,
  operation: ApiDiagnosticOperation,
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    // Each phase is independent; a failure is reported and the rest still run,
    // exactly as the systemd timer entrypoint behaved.
    console.error(`${name} failed:`, error);
    reportBackgroundFailure(error, operation);
    return null;
  }
}

/** Replaces the per-minute `tearleads-stripe-seat-sync` systemd timer. */
async function runBillingMaintenance(): Promise<void> {
  const runtime = getDefaultApiServiceRuntime();
  const trialExpiry = await runPhase(
    "Free-trial expiry",
    () => expireOrganizationTrials(runtime, {}),
    "billing.trial-expiry",
  );
  const organizationPurge = await runPhase(
    "Organization purge",
    () => runOrganizationPurgeMaintenance(runtime, {}),
    "billing.purge",
  );
  const stripeSeatSync = await runPhase(
    "Stripe seat synchronization",
    () => runStripeSeatSynchronization(runtime, {}),
    "billing.seat-sync",
  );
  console.log(
    JSON.stringify({ organizationPurge, stripeSeatSync, trialExpiry }),
  );
}

/** Replaces the hourly `tearleads-blob-gc` systemd timer. */
async function runBlobGarbageCollection(): Promise<void> {
  try {
    const summary = await runBlobMaintenance(getDefaultApiServiceRuntime(), {
      dereferencedBlobs: {},
      expiredStages: {},
    });
    console.log(JSON.stringify(summary));
  } catch (error) {
    console.error("Blob GC maintenance failed:", error);
    reportBackgroundFailure(error, "blob.maintenance");
  }
}

export async function runScheduledMaintenance(cron: string): Promise<void> {
  try {
    if (cron === BLOB_MAINTENANCE_CRON) {
      await runBlobGarbageCollection();
      return;
    }
    if (cron === BILLING_MAINTENANCE_CRON) {
      await runBillingMaintenance();
      return;
    }
    console.error(`Unknown maintenance schedule: ${cron}`);
  } finally {
    await flushApiDiagnostics();
  }
}

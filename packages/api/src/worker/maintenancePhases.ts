import type { ApiDiagnosticOperation } from "@tearleads/diagnostics/server";

export interface MaintenancePhase {
  readonly name: string;
  readonly operation: ApiDiagnosticOperation;
  readonly run: () => Promise<unknown>;
}

/** Raised after every phase ran, so a Cron run records its failure. */
export class MaintenanceFailedError extends Error {
  constructor(readonly failedPhases: readonly string[]) {
    super(`Maintenance failed: ${failedPhases.join(", ")}`);
    this.name = "MaintenanceFailedError";
  }
}

/** Summaries count per-item failures under `failed`, at any depth. */
function countFailedItems(summary: unknown): number {
  if (typeof summary !== "object" || summary === null) {
    return 0;
  }
  let failed = 0;
  for (const [key, value] of Object.entries(summary)) {
    if (key === "failed" && typeof value === "number") {
      failed += value;
    } else {
      failed += countFailedItems(value);
    }
  }
  return failed;
}

/**
 * Each phase is independent, so one failure never skips the rest; the run then
 * rejects, so a Cron invocation whose phase threw or whose items failed is
 * recorded as a failed run instead of a success.
 */
export async function runMaintenancePhases(
  phases: readonly MaintenancePhase[],
  report: (error: unknown, operation: ApiDiagnosticOperation) => void,
): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = {};
  const failed: string[] = [];
  for (const phase of phases) {
    try {
      const result = await phase.run();
      summary[phase.name] = result;
      if (countFailedItems(result) > 0) {
        failed.push(phase.name);
      }
    } catch (error) {
      console.error(`${phase.name} failed:`, error);
      report(error, phase.operation);
      failed.push(phase.name);
    }
  }
  console.log(JSON.stringify(summary));
  if (failed.length > 0) {
    throw new MaintenanceFailedError(failed);
  }
  return summary;
}

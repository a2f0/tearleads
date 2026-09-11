import type { DocumentSyncUpdateIsolationError } from "../../data/documents/shared/documentSyncUpdateIsolation";
import type { WorkflowRuntimeUtilInput } from "../runtimeInput";

/** Keep host diagnostics failures from replacing the durable quarantine. */
export function reportDocumentSyncQuarantine(
  logError: WorkflowRuntimeUtilInput["logError"] | undefined,
  failure: DocumentSyncUpdateIsolationError,
): void {
  try {
    void Promise.resolve(
      logError?.("Documents: sync updates quarantined", failure),
    ).catch(() => undefined);
  } catch {
    // Hosts may throw synchronously or return a rejected promise.
  }
}

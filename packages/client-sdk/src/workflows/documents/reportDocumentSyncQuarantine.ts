import type { DocumentSyncUpdateIsolationError } from "../../data/documents/shared/documentSyncUpdateIsolation";
import type { WorkflowRuntimeUtilInput } from "../runtimeInput";

const lastQuarantineByScope = new WeakMap<object, string>();

/** Keep host diagnostics failures from replacing the durable quarantine. */
export function reportDocumentSyncQuarantine(
  scope: object,
  logError: WorkflowRuntimeUtilInput["logError"] | undefined,
  failure: DocumentSyncUpdateIsolationError,
): void {
  if (!logError) return;
  const signature = JSON.stringify([failure.message, failure.batchUpdateIds]);
  if (lastQuarantineByScope.get(scope) === signature) return;
  // Suppress repeats before the host appends local logs and breadcrumbs. Keep
  // only the last failure, and let discarded document scopes be collected.
  lastQuarantineByScope.set(scope, signature);
  try {
    void Promise.resolve(
      logError("Documents: sync updates quarantined", failure),
    ).catch(() => undefined);
  } catch {
    // Hosts may throw synchronously or return a rejected promise.
  }
}

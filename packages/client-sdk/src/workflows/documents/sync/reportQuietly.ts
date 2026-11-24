import type { WorkflowRuntimeUtilInput } from "../../shared/runtimeInput";

/**
 * Reports to the host without letting the report fail a sync pass: hosts
 * may throw synchronously or return a rejected promise.
 */
export function reportQuietly(
  logError: WorkflowRuntimeUtilInput["logError"] | undefined,
  message: string,
  error: unknown,
): void {
  if (!logError) return;
  try {
    void Promise.resolve(logError(message, error)).catch(() => undefined);
  } catch {
    // Reporting never fails a sync pass.
  }
}

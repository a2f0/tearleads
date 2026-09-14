import {
  type ContainerDocumentLinks,
  isDatabaseUnavailableError,
  isProjectionVerificationCancelledError,
} from "@tearleads/client-sdk";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { useRuntimeScopedMemo } from "../../providers/sdk/useRuntimeScopedMemo";

// Teardown rather than a failed action: the runtime is released under
// in-flight callers on every identity switch, logout, and Explorer retry, and
// a projection verification cancelled by a newer generation re-runs on its
// own. Reporting either would outrank every real failure.
export function isIgnorableDatabaseWorkerError(error: unknown): boolean {
  return (
    isDatabaseUnavailableError(error) ||
    isProjectionVerificationCancelledError(error)
  );
}

export function useExplorerDocumentLinks(): ContainerDocumentLinks {
  const { containerContents } = useTearleads();

  return useRuntimeScopedMemo(
    () => containerContents.documentLinks(),
    [containerContents],
  );
}

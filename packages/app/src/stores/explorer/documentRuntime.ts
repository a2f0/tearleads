import type { ContainerDocumentLinks } from "@tearleads/client-sdk";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { useRuntimeScopedMemo } from "../../providers/sdk/useRuntimeScopedMemo";

export function isDestroyedDatabaseWorkerError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Database worker client has been destroyed."
  );
}

export function isIgnorableDatabaseWorkerError(error: unknown): boolean {
  return (
    isDestroyedDatabaseWorkerError(error) ||
    (error instanceof Error &&
      error.message === "Database client is unavailable.")
  );
}

export function useExplorerDocumentLinks(): ContainerDocumentLinks {
  const { containerContents } = useTearleads();

  return useRuntimeScopedMemo(
    () => containerContents.documentLinks(),
    [containerContents],
  );
}

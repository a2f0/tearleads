import type { ContainerDocumentLinks } from "@symcrypt/client-sdk";
import { useSymCrypt } from "../../providers/sdk/SymCryptProvider";
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
  const { containerContents } = useSymCrypt();

  return useRuntimeScopedMemo(
    () => containerContents.documentLinks(),
    [containerContents],
  );
}

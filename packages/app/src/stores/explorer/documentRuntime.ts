import type { TearleadsContainerDocumentLinksRuntime } from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";

export interface ExplorerDocumentsRuntimeAppDataInput {
  dbStatus: string;
  domainScope: object;
  events: ReadonlyArray<unknown>;
  isAuthenticated: boolean;
  online: boolean;
}

export type ExplorerDocumentsRuntimeAppData =
  TearleadsContainerDocumentLinksRuntime;

export function isDestroyedDatabaseWorkerError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Database worker client has been destroyed."
  );
}

export function useExplorerDocumentsRuntimeAppData(
  appData: ExplorerDocumentsRuntimeAppDataInput,
): ExplorerDocumentsRuntimeAppData {
  const { containerContents } = useTearleads();

  return useMemo(
    () => containerContents.documentLinksRuntime(),
    [appData, containerContents],
  );
}

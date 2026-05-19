import {
  createExplorerWorkflowRuntime,
  type ExplorerProjectionUserKeyResolver,
  type ExplorerWorkflowRuntime,
  type ExplorerWorkflowRuntimeInput,
} from "@tearleads/client-sdk/workflows/explorer/index";
import { useMemo } from "react";
import type { primeDocumentStore } from "../documents/DocumentsProvider";

type ExplorerDocumentRuntime = Parameters<typeof primeDocumentStore>[2];

export type ExplorerDocumentsRuntimeAppDataInput = ExplorerWorkflowRuntimeInput;

export type ExplorerDocumentsRuntimeAppData = ExplorerWorkflowRuntime & {
  resolveProjectionUserKey: ExplorerProjectionUserKeyResolver;
};

export function isDestroyedDatabaseWorkerError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Database worker client has been destroyed."
  );
}

export function createExplorerDocumentsRuntime(
  appData: ExplorerDocumentsRuntimeAppData,
  containerId: string,
): ExplorerDocumentRuntime {
  return appData.createDocumentsRuntime(containerId);
}

export function useExplorerDocumentsRuntimeAppData(
  appData: ExplorerDocumentsRuntimeAppDataInput,
): ExplorerDocumentsRuntimeAppData {
  const runtime = useMemo(
    () => createExplorerWorkflowRuntime(appData),
    [appData],
  );
  const resolveProjectionUserKey = useMemo(
    () => runtime.createDocumentProjectionUserKeyResolver(),
    [runtime],
  );

  return useMemo(
    () => ({
      ...runtime,
      resolveProjectionUserKey,
    }),
    [runtime, resolveProjectionUserKey],
  );
}

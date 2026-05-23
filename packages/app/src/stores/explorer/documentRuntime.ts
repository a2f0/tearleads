import type { TearleadsWorkflowRuntimeInput } from "@tearleads/client-sdk";
import type {
  ContainerContentsProjectionUserKeyResolver,
  ContainerContentsWorkflowRuntime,
} from "@tearleads/client-sdk/workflows/container-contents";
import { useMemo } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import type { primeDocumentStore } from "../documents/DocumentsProvider";

type ExplorerDocumentRuntime = Parameters<typeof primeDocumentStore>[2];

export type ExplorerDocumentsRuntimeAppDataInput =
  TearleadsWorkflowRuntimeInput;

export type ExplorerDocumentsRuntimeAppData =
  ContainerContentsWorkflowRuntime & {
    resolveProjectionUserKey: ContainerContentsProjectionUserKeyResolver;
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
  const { containerContents } = useTearleads();
  const runtime = useMemo(
    () => containerContents.runtime(),
    [appData, containerContents],
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

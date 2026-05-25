import type { ContainerDocumentLinksRuntime } from "@tearleads/client-sdk";
import { useMemo } from "react";
import {
  type RuntimeSnapshot,
  useTearleads,
} from "../../providers/sdk/TearleadsProvider";

export interface ExplorerDocumentsRuntimeAppDataInput {
  auth: RuntimeSnapshot["auth"];
  crypto: RuntimeSnapshot["crypto"];
  infra: RuntimeSnapshot["infra"];
  state: RuntimeSnapshot["state"];
  util: RuntimeSnapshot["util"];
}

export function isDestroyedDatabaseWorkerError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Database worker client has been destroyed."
  );
}

export function useExplorerDocumentsRuntimeAppData(
  appData: ExplorerDocumentsRuntimeAppDataInput,
): ContainerDocumentLinksRuntime {
  const { containerContents } = useTearleads();

  return useMemo(
    () => containerContents.documentLinksRuntime(),
    [
      appData.auth,
      appData.crypto,
      appData.infra,
      appData.state,
      appData.util,
      containerContents,
    ],
  );
}

import type { DocumentInfo } from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  type RuntimeSnapshot,
  useTearleads,
} from "../../providers/sdk/TearleadsProvider";

export function useExplorerDocumentInfoLoader(input: {
  readonly appData: Pick<RuntimeSnapshot, "isAuthenticated" | "online">;
}): (localId: string) => Promise<DocumentInfo> {
  const { appData } = input;
  const { containerContents } = useTearleads();

  return useCallback(
    (localId: string) =>
      containerContents.loadDocumentInfo({
        localId,
        remoteInfoMode:
          appData.isAuthenticated && appData.online ? "if-synced" : "never",
      }),
    [appData.isAuthenticated, appData.online, containerContents],
  );
}

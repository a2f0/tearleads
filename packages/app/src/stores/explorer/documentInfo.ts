import type { TearleadsDocumentInfo } from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  type TearleadsRuntimeSnapshot,
  useTearleads,
} from "../../providers/sdk/TearleadsProvider";

export type ExplorerDocumentInfo = TearleadsDocumentInfo;

export function useExplorerDocumentInfoLoader(input: {
  readonly appData: Pick<
    TearleadsRuntimeSnapshot,
    "isAuthenticated" | "online"
  >;
}): (localId: string) => Promise<ExplorerDocumentInfo> {
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

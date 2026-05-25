import type { DocumentInfo } from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  type RuntimeSnapshot,
  useTearleads,
} from "../../providers/sdk/TearleadsProvider";

export function useExplorerDocumentInfoLoader(input: {
  readonly appData: Pick<RuntimeSnapshot, "auth" | "state">;
}): (localId: string) => Promise<DocumentInfo> {
  const { appData } = input;
  const { containerContents } = useTearleads();

  return useCallback(
    (localId: string) =>
      containerContents.loadDocumentInfo({
        localId,
        remoteInfoMode:
          appData.auth.isAuthenticated && appData.state.online
            ? "if-synced"
            : "never",
      }),
    [appData.auth, appData.state, containerContents],
  );
}

import type { BlobInfoInput, BlobInfoList } from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  type RuntimeSnapshot,
  useTearleads,
} from "../../providers/sdk/TearleadsProvider";

// The one shape every consumer of the blob-info loader shares.
export type ExplorerBlobInfoLoader = (
  query?: BlobInfoInput | undefined,
) => Promise<BlobInfoList>;

export function useExplorerBlobInfoLoader(input: {
  readonly appData: Pick<RuntimeSnapshot, "infra" | "state">;
}): ExplorerBlobInfoLoader {
  const { appData } = input;
  const { containerContents } = useTearleads();

  return useCallback(
    (query?: BlobInfoInput | undefined) =>
      containerContents.listBlobInfo(query),
    [appData.infra, appData.state, containerContents],
  );
}

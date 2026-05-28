import type { BlobInfoInput, BlobInfoList } from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  type RuntimeSnapshot,
  useTearleads,
} from "../../providers/sdk/TearleadsProvider";

export function useExplorerBlobInfoLoader(input: {
  readonly appData: Pick<RuntimeSnapshot, "infra" | "state">;
}): (query?: BlobInfoInput | undefined) => Promise<BlobInfoList> {
  const { appData } = input;
  const { containerContents } = useTearleads();

  return useCallback(
    (query?: BlobInfoInput | undefined) =>
      containerContents.listBlobInfo(query),
    [appData.infra, appData.state, containerContents],
  );
}

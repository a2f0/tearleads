import type { BlobInfoInput, BlobInfoList } from "@symcrypt/client-sdk";
import { useCallback } from "react";
import {
  type RuntimeSnapshot,
  useSymCrypt,
} from "../../providers/sdk/SymCryptProvider";

// The one shape every consumer of the blob-info loader shares.
export type ExplorerBlobInfoLoader = (
  query?: BlobInfoInput | undefined,
) => Promise<BlobInfoList>;

export function useExplorerBlobInfoLoader(input: {
  readonly appData: Pick<RuntimeSnapshot, "infra" | "state">;
}): ExplorerBlobInfoLoader {
  const { appData } = input;
  const { containerContents } = useSymCrypt();

  return useCallback(
    (query?: BlobInfoInput | undefined) =>
      containerContents.listBlobInfo(query),
    [appData.infra, appData.state, containerContents],
  );
}

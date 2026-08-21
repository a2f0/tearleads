import type { ContainerInfo, ContainerNode } from "@symcrypt/client-sdk";
import { useCallback, useMemo } from "react";
import {
  type RuntimeSnapshot,
  useSymCrypt,
} from "../../providers/sdk/SymCryptProvider";

export function useExplorerContainerInfoLoader(input: {
  readonly appData: Pick<RuntimeSnapshot, "auth" | "state">;
  readonly nodes: ReadonlyArray<ContainerNode>;
}): (containerId: string) => Promise<ContainerInfo> {
  const { appData, nodes } = input;
  const { containerContents } = useSymCrypt();
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  return useCallback(
    (containerId: string) => {
      const node = nodesById.get(containerId);
      return containerContents.loadContainerInfo({
        containerId,
        parentId: node?.parentId ?? null,
        remoteInfoMode:
          appData.auth.isAuthenticated && appData.state.online
            ? "if-synced"
            : "never",
      });
    },
    [appData.auth, appData.state, containerContents, nodesById],
  );
}

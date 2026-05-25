import type {
  TearleadsContainerInfo,
  TearleadsContainerShareAccessLevel,
} from "@tearleads/client-sdk";
import { useCallback, useMemo } from "react";
import {
  type TearleadsRuntimeSnapshot,
  useTearleads,
} from "../../providers/sdk/TearleadsProvider";
import type { ContainerNode } from "./types";

export type ExplorerContainerInfo = TearleadsContainerInfo;
export type ExplorerContainerShareAccessLevel =
  TearleadsContainerShareAccessLevel;

export function useExplorerContainerInfoLoader(input: {
  readonly appData: Pick<
    TearleadsRuntimeSnapshot,
    "isAuthenticated" | "online"
  >;
  readonly nodes: ReadonlyArray<ContainerNode>;
}): (containerId: string) => Promise<ExplorerContainerInfo> {
  const { appData, nodes } = input;
  const { containerContents } = useTearleads();
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  return useCallback(
    (containerId: string) => {
      const node = nodesById.get(containerId);
      return containerContents.loadInfo({
        containerId,
        parentId: node?.parentId ?? null,
        remoteInfoMode:
          appData.isAuthenticated && appData.online ? "if-synced" : "never",
      });
    },
    [appData.isAuthenticated, appData.online, containerContents, nodesById],
  );
}

import {
  type ExplorerContainerInfo,
  type ExplorerContainerInfoRemoteMode,
  loadExplorerContainerInfo as loadExplorerContainerInfoWorkflow,
} from "@tearleads/client-sdk/workflows/explorer/index";
import { useCallback, useMemo } from "react";
import type { AppDataContextValue } from "../../providers/data/AppDataProvider";
import type { ContainerNode } from "./types";

export type {
  ExplorerContainerInfo,
  ExplorerContainerShareAccessLevel,
} from "@tearleads/client-sdk/workflows/explorer/index";

function loadExplorerContainerInfo(input: {
  readonly appData: Pick<
    AppDataContextValue,
    "apiClient" | "dbStatus" | "execSql" | "organizationId"
  >;
  readonly containerId: string;
  readonly parentId?: string | null;
  readonly remoteInfoMode?: ExplorerContainerInfoRemoteMode;
}): Promise<ExplorerContainerInfo> {
  return loadExplorerContainerInfoWorkflow({
    apiClient: input.appData.apiClient,
    containerId: input.containerId,
    execSql: input.appData.dbStatus === "ready" ? input.appData.execSql : null,
    organizationId: input.appData.organizationId,
    parentId: input.parentId ?? null,
    remoteInfoMode: input.remoteInfoMode,
  });
}

export function useExplorerContainerInfoLoader(input: {
  readonly appData: Pick<
    AppDataContextValue,
    | "apiClient"
    | "dbStatus"
    | "execSql"
    | "isAuthenticated"
    | "online"
    | "organizationId"
  >;
  readonly nodes: ReadonlyArray<ContainerNode>;
}): (containerId: string) => Promise<ExplorerContainerInfo> {
  const { appData, nodes } = input;
  const containerInfoAppData = useMemo(
    () => ({
      apiClient: appData.apiClient,
      dbStatus: appData.dbStatus,
      execSql: appData.execSql,
      organizationId: appData.organizationId,
    }),
    [
      appData.apiClient,
      appData.dbStatus,
      appData.execSql,
      appData.organizationId,
    ],
  );
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  return useCallback(
    (containerId: string) => {
      const node = nodesById.get(containerId);
      return loadExplorerContainerInfo({
        appData: containerInfoAppData,
        containerId,
        parentId: node?.parentId ?? null,
        remoteInfoMode:
          appData.isAuthenticated && appData.online ? "if-synced" : "never",
      });
    },
    [appData.isAuthenticated, appData.online, containerInfoAppData, nodesById],
  );
}

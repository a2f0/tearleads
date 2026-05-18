import type { AppDataContextValue } from "../../providers/data/AppDataProvider";
import {
  type ExplorerContainerInfo,
  type ExplorerContainerInfoRemoteMode,
  loadExplorerContainerInfo as loadExplorerContainerInfoWorkflow,
} from "../../workflows/explorer";

export type {
  ExplorerContainerInfo,
  ExplorerContainerShareAccessLevel,
} from "../../workflows/explorer";

export function loadExplorerContainerInfo(input: {
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

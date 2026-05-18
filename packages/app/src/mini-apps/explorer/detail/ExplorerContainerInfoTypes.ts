import type { ExplorerContainerInfo } from "../../../stores/explorer/containerInfo";

export type ExplorerContainerInfoGrant = NonNullable<
  ExplorerContainerInfo["remoteInfo"]
>["grants"][number];

export type ReloadExplorerContainerInfo = (options?: {
  optimisticGrant?: ExplorerContainerInfoGrant | null;
  resetDrafts?: boolean;
}) => Promise<void>;

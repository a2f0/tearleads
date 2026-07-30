import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerContentsProjectionUserKeyResolver } from "../../workflows/container-contents/projectionKeys";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import type { ContainerContentsStoreWorkflowRuntime } from "../../workflows/container-contents/runtime";
import type { ContainerContentsSyncLane } from "../../workflows/container-contents/syncLane";

export type ContainerContentsStoreRuntime =
  ContainerContentsStoreWorkflowRuntime;

export interface ContainerContentsStoreSyncState {
  containersById: Map<string, ContainerState>;
  documentStoresNeedPriming: boolean;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  localContainerRefreshPromise: Promise<void> | null;
  localContainersNeedRefresh: boolean;
  lastEventCount: number;
  /** Update ids this client sent, consumed when their remote echoes arrive. */
  locallyAcceptedMetadataUpdateIds: Set<string>;
  logLabel?: string | undefined;
  metadataDocumentIdsNeedingSync: Set<string>;
  /** Per-document enqueue generation guarding in-flight queue clears. */
  metadataSyncSignalSeqById: Map<string, number>;
  containerParentIdsNeedingHydration: Set<string | null>;
  persistence: ContainerContentsPersistence;
  remoteHydrationPromise: Promise<void> | null;
  resolveProjectionUserKey: ContainerContentsProjectionUserKeyResolver;
  /** True after this store has fully applied an authoritative root lane. */
  rootLaneHydrated: boolean;
  runtime: ContainerContentsStoreRuntime;
  snapshot: { ready: boolean };
  syncLane: ContainerContentsSyncLane | null;
}

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
  initializeGeneration: number | null;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  localContainerRefreshPromise: Promise<void> | null;
  localContainerRefreshGeneration: number | null;
  localContainerRefreshStructuralGeneration: number | null;
  localContainersNeedRefresh: boolean;
  /** Invalidates asynchronous hydration work when this store is reset. */
  lifecycleGeneration: number;
  /** Invalidates structural work when its runtime or persistence is replaced. */
  structuralGeneration: number;
  /** Invalidates writes across write-relevant runtime ABA transitions. */
  writeGeneration: number;
  lastEventCount: number;
  /**
   * Update ids this client sent for container metadata documents, registered
   * before the network await of each metadata sync pass. The author's own
   * `document_update_created` echo consumes its ids here instead of arming a
   * redundant forced read-sync; a genuine peer update always carries unknown
   * ids and still forces one. Shared across all metadata docs in the store —
   * update ids are globally unique.
   */
  locallyAcceptedMetadataUpdateIds: Set<string>;
  logLabel?: string | undefined;
  metadataDocumentIdsNeedingSync: Set<string>;
  /**
   * Per-metadata-document enqueue sequence. Bumped for a specific id whenever a
   * remote event re-queues it in {@link metadataDocumentIdsNeedingSync}. A sync
   * pass snapshots the id's sequence before its GET and only clears the id if it
   * is unchanged at pass end, so a mid-pass re-queue of THIS container is not
   * erased. Keyed per id (not a single global counter) so a remote event for an
   * unrelated container does not force a redundant re-sync of this one. See
   * `clearMetadataSyncQueueIfUnchanged`.
   */
  metadataSyncSignalSeqById: Map<string, number>;
  containerParentIdsNeedingHydration: Set<string | null>;
  persistence: ContainerContentsPersistence;
  remoteHydrationPromise: Promise<void> | null;
  remoteHydrationGeneration: number | null;
  remoteHydrationStructuralGeneration: number | null;
  resolveProjectionUserKey: ContainerContentsProjectionUserKeyResolver;
  /** True after this store has fully applied an authoritative root lane. */
  rootLaneHydrated: boolean;
  runtime: ContainerContentsStoreRuntime;
  snapshot: { ready: boolean };
  syncLane: ContainerContentsSyncLane | null;
}

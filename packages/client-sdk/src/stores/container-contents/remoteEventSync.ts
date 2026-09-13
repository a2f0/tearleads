import {
  listContainerMutationEventContainerIds,
  listContainerParentIdsForEventHydration,
} from "../../workflows/container-contents/containerEvents";
import { listContainerMetadataDocumentUpdateIds } from "../../workflows/container-contents/metadata";
import { bumpMetadataSyncSeq } from "./metadataSyncSignal";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

export function handleContainerContentsRemoteEvents(input: {
  requestHydration: () => Promise<void>;
  scheduleSync: () => void;
  state: ContainerContentsStoreSyncState;
}): void {
  const { requestHydration, scheduleSync, state } = input;
  // Metadata events are classified through the initialized container records.
  // Do not consume the cursor while a replacement database is still loading;
  // initialization calls this handler again once those identities exist.
  if (!state.initialized) {
    return;
  }
  const nextEvents = state.runtime.state.events.slice(state.lastEventCount);
  state.lastEventCount = state.runtime.state.events.length;
  // A peer's grant, rekey, or recite changed the container's manifest head
  // without evicting this subscriber. Drop both cached writer projections now,
  // before hydration lands, so the next share or move fetches a fresh one
  // instead of submitting against the stale manifest and conflicting.
  for (const containerId of listContainerMutationEventContainerIds(
    nextEvents,
  )) {
    const containerState = state.containersById.get(containerId);
    if (containerState) containerState.containerWriterProjection = null;
    state.runtime.apiClient.evictContainerWriterProjection(containerId);
  }
  let addedHydrationLane = false;
  for (const parentId of listContainerParentIdsForEventHydration(nextEvents)) {
    if (!state.containerParentIdsNeedingHydration.has(parentId)) {
      addedHydrationLane = true;
    }
    state.containerParentIdsNeedingHydration.add(parentId);
  }
  if (addedHydrationLane) {
    void requestHydration();
  }

  const metadataDocumentIds = listContainerMetadataDocumentUpdateIds(
    nextEvents,
    state.containersById.values(),
    state.locallyAcceptedMetadataUpdateIds,
  );
  for (const metadataDocumentId of metadataDocumentIds) {
    state.metadataDocumentIdsNeedingSync.add(metadataDocumentId);
    bumpMetadataSyncSeq(state.metadataSyncSignalSeqById, metadataDocumentId);
  }
  if (metadataDocumentIds.length > 0) {
    scheduleSync();
  }
}

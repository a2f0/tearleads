import {
  listContainerParentIdsForEventHydration,
  listContainerProjectionInvalidationIds,
} from "../../workflows/container-contents/containerEvents";
import { listContainerMetadataDocumentUpdateIds } from "../../workflows/container-contents/metadata";
import { observeContainerBackgroundHydration } from "./backgroundHydration";
import { bumpMetadataSyncSeq } from "./metadataSyncSignal";
import { invalidateCachedProjections } from "./remoteEventProjectionInvalidation";
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
  // A peer's grant, rekey, or recite changed a manifest this client's cached
  // projections cite, without evicting this subscriber.
  invalidateCachedProjections(
    state,
    listContainerProjectionInvalidationIds(nextEvents),
  );
  let addedHydrationLane = false;
  for (const parentId of listContainerParentIdsForEventHydration(nextEvents)) {
    if (!state.containerParentIdsNeedingHydration.has(parentId)) {
      addedHydrationLane = true;
    }
    state.containerParentIdsNeedingHydration.add(parentId);
  }
  if (addedHydrationLane) {
    observeContainerBackgroundHydration(state, requestHydration());
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

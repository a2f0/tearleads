import type {
  ContainerParentLaneIdsPage,
  EffectiveAccessLevel,
} from "@tearleads/validators/response";
import { changesDiscoveryOrder } from "../../documentDiscovery/publicationWatermark";
import {
  hasUnusableContinuation,
  queueNextPage,
} from "../lanes/parentLanePaging";
import type {
  ContainerParentHydrationLane,
  FetchedContainerParentLaneIdsPage,
  HydrationOutcome,
  RemoteContainerHydrationState,
} from "../types";
import { loadPausedContainerFilter } from "./organizationSyncPauseFilter";

const ACCESS_LEVEL_RANK: Record<EffectiveAccessLevel, number> = {
  read: 1,
  write: 2,
  admin: 3,
};

function needsFullRootListing(
  item: ContainerParentLaneIdsPage["items"][number],
  state: RemoteContainerHydrationState,
): boolean {
  const held = state.containersById.get(item.id);
  if (
    !held ||
    held.container.serverCreatedAt == null ||
    held.container.metadataDocumentId == null
  ) {
    return true;
  }
  const heldRank =
    ACCESS_LEVEL_RANK[held.container.effectiveAccessLevel ?? "read"];
  return ACCESS_LEVEL_RANK[item.directAccessLevel] > heldRank;
}

/**
 * Reconciles a compact `idsOnly` root-membership page against already-held
 * local containers. Steady reconnects where every visible root is already held
 * at matching or higher access do zero verification or persistence work; a
 * newly granted or access-upgraded root queues one full unwatermarked root
 * membership listing (without `idsOnly`) to verify and ingest it.
 */
export async function applyIdsOnlyParentLanePage(input: {
  readonly fetchedPage: FetchedContainerParentLaneIdsPage;
  readonly fullRootFallbackQueued: { queued: boolean };
  readonly isCurrent?: (() => boolean) | undefined;
  readonly queueContinuationLane: (lane: ContainerParentHydrationLane) => void;
  readonly state: RemoteContainerHydrationState;
}): Promise<{
  readonly outcome: HydrationOutcome;
  readonly shouldStop: boolean;
}> {
  const { fetchedPage, state } = input;
  const { lane, response } = fetchedPage;
  if (input.isCurrent?.() === false) {
    return { outcome: "retry", shouldStop: true };
  }
  if (
    changesDiscoveryOrder(
      lane.watermark,
      response.nextWatermark,
      !!lane.continuationCursors,
    )
  ) {
    return { outcome: "retry", shouldStop: false };
  }
  const isPaused = await loadPausedContainerFilter(state);
  if (input.isCurrent?.() === false) {
    return { outcome: "retry", shouldStop: true };
  }
  const requiresFullListing = response.items.some(
    (item) => !isPaused(item) && needsFullRootListing(item, state),
  );
  if (requiresFullListing) {
    if (!input.fullRootFallbackQueued.queued) {
      input.fullRootFallbackQueued.queued = true;
      input.queueContinuationLane({
        membershipOnly: true,
        parentId: null,
        skipWatermarkWrite: true,
        watermark: null,
      });
    }
    return { outcome: "complete", shouldStop: false };
  }
  if (hasUnusableContinuation(fetchedPage)) {
    return { outcome: "retry", shouldStop: false };
  }
  queueNextPage(fetchedPage, true, input.queueContinuationLane);
  return { outcome: "complete", shouldStop: false };
}

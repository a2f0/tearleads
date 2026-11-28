import type { ContainerParentLaneIdsPage } from "@tearleads/validators/response";
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
  // Compare exact verified effectiveAccessLevel so both upgrades and
  // group-membership downgrades trigger a full verified refresh.
  return held.container.effectiveAccessLevel !== item.effectiveAccessLevel;
}

/**
 * Reconciles a compact verified `idsOnly` root-membership page against
 * already-held local containers. Steady reconnects where every visible root is
 * already held with matching `effectiveAccessLevel` do zero verification or
 * persistence work; a newly granted, local-only, or access-changed root queues
 * one full unwatermarked root membership listing (without `idsOnly`) to verify
 * and ingest it.
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

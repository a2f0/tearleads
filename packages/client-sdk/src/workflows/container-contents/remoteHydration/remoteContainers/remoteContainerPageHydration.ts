import {
  createPrincipalPolicyOperation,
  type PrincipalPolicyOperation,
} from "../../../principals/principalPolicyService";
import { prefetchDestinationProjections } from "../destination/destinationPrefetch";
import { cachedDestinationRole } from "../destination/destinationRoleCache";
import { markContainerParentLaneFetched } from "../lanes/laneFetchMarkers";
import { fetchContainerParentLaneBatch } from "../lanes/parentLaneFetch";
import { warmListedContainerPolicies } from "../principalPolicyCache";
import {
  applyContainerTombstones,
  getApplicableRemoteContainerItems,
} from "../tombstoneApplication";
import type {
  ContainerChildIndex,
  ContainerParentHydrationLane,
  ExpectedContainerState,
  FetchedContainerParentLanePage,
  HydrationOutcome,
  ListedRemoteContainerPageItem,
  QueueContainerParentLane,
  ReconnectPages,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
} from "../types";
import { containerStateMatchesFingerprint } from "./containerStateFingerprint";
import { loadPausedContainerFilter } from "./organizationSyncPauseFilter";
import {
  listRemoteContainerIdsWithPendingMetadataUpdates,
  listRemoteContainerIdsWithPendingStructuralIntents,
  upsertIsolatedRemoteContainerState,
} from "./remoteContainerState";

const CONTAINER_PARENT_HYDRATION_CONCURRENCY = 4;

interface HydrationProgress {
  changedCount: number;
  outcome: HydrationOutcome;
  shouldStop: boolean;
}
/** A retryable lane takes precedence over a refused proof elsewhere in the crawl. */
function combineOutcomes(
  a: HydrationOutcome,
  b: HydrationOutcome,
): HydrationOutcome {
  if (a === "retry" || b === "retry") return "retry";
  if (a === "refused" || b === "refused") return "refused";
  return "complete";
}

// Re-checked inside the commit: a pause from another device can land after
// the page was filtered, and its cleanup may already have run.
function currentUnlessPaused(
  input: {
    isCurrent?: (() => boolean) | undefined;
    isPaused: (container: ListedRemoteContainerPageItem) => boolean;
  },
  container: ListedRemoteContainerPageItem,
): () => boolean {
  return () => input.isCurrent?.() !== false && !input.isPaused(container);
}

/** The local state still matches the fingerprint the listing was read at. */
function matchesListedState(
  state: RemoteContainerHydrationState,
  expectedContainerStates: ReadonlyMap<string, ExpectedContainerState>,
  containerId: string,
): boolean {
  return containerStateMatchesFingerprint({
    currentState: state.containersById.get(containerId),
    expectedFingerprint: expectedContainerStates.get(containerId)?.fingerprint,
  });
}

async function applyRemoteContainerPage(input: {
  reconnect?: ReconnectPages | undefined;
  childIdsByParentId: ContainerChildIndex;
  expectedContainerStates: ReadonlyMap<string, ExpectedContainerState>;
  expectedHydrationTombstones: FetchedContainerParentLanePage["expectedHydrationTombstones"];
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  /** Live pause check; a pause arriving mid-page stops the commit. */
  isPaused: (container: ListedRemoteContainerPageItem) => boolean;
  items: ReadonlyArray<ListedRemoteContainerPageItem>;
  /** The hydration pass's token: its pages share one directory discovery. */
  policyOperation: PrincipalPolicyOperation;
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: RemoteContainerHydrationState;
}): Promise<{ changedCount: number; outcome: HydrationOutcome }> {
  const {
    expectedContainerStates,
    expectedHydrationTombstones,
    queueParentLane,
    seenContainerIds,
    state,
  } = input;
  let hydratedCount = 0;
  const policies = await warmListedContainerPolicies(
    input.items,
    state.runtime.principalPolicies.createWarmer({
      operation: input.policyOperation,
    }),
    !!input.reconnect,
    input.isCurrent,
  );
  const { items } = policies;
  let outcome: HydrationOutcome = policies.outcome;
  if (input.isCurrent?.() === false) {
    return { changedCount: 0, outcome: "retry" };
  }
  const [
    containerIdsWithPendingMetadataUpdates,
    containerIdsWithPendingStructuralIntents,
  ] = await Promise.all([
    listRemoteContainerIdsWithPendingMetadataUpdates({
      remoteContainers: items,
      state,
    }),
    listRemoteContainerIdsWithPendingStructuralIntents({
      remoteContainers: items,
      state,
    }),
  ]);
  if (input.isCurrent?.() === false) {
    return { changedCount: 0, outcome: "retry" };
  }
  const prefetchedProjections = await prefetchDestinationProjections({
    containers: items.filter(
      (item) =>
        !seenContainerIds.has(item.id) &&
        !state.containersById.has(item.id) &&
        !expectedHydrationTombstones.get(item.id) &&
        !cachedDestinationRole(state.runtime.infra.execSql, item),
    ),
    isCurrent: input.isCurrent,
    runtime: state.runtime,
  });
  for (const container of items) {
    if (input.isCurrent?.() === false) {
      return { changedCount: hydratedCount, outcome: "retry" };
    }
    if (seenContainerIds.has(container.id)) {
      queueParentLane(container.id);
      continue;
    }
    if (!matchesListedState(state, expectedContainerStates, container.id)) {
      outcome = "retry";
      continue;
    }
    let failure: HydrationOutcome = "retry";
    const upserted = await upsertIsolatedRemoteContainerState(
      {
        childIdsByParentId: input.childIdsByParentId,
        containerIdsWithPendingMetadataUpdates,
        containerIdsWithPendingStructuralIntents,
        host: input.host,
        isCurrent: currentUnlessPaused(input, container),
        expectedHydrationTombstone:
          expectedHydrationTombstones.get(container.id) ?? null,
        prefetchedProjection: prefetchedProjections.get(container.id),
        remoteContainer: container,
        state,
      },
      (outcome) => {
        failure = outcome;
      },
      input.reconnect?.recordUnavailable,
    );
    if (!upserted) {
      outcome = combineOutcomes(outcome, failure);
      continue;
    }
    seenContainerIds.add(container.id);
    hydratedCount += 1;
    if (input.isCurrent?.() === false) {
      return { changedCount: hydratedCount, outcome: "retry" };
    }
    queueParentLane(container.id);
  }

  return { changedCount: hydratedCount, outcome };
}

export function canHydrateRemoteContainers(
  state: RemoteContainerHydrationState,
): boolean {
  return (
    state.runtime.auth.isAuthenticated &&
    state.runtime.state.online &&
    state.runtime.infra.dbStatus === "ready"
  );
}

function cursorKey(
  watermark: NonNullable<ContainerParentHydrationLane["watermark"]>,
): string {
  return JSON.stringify([watermark.updatedAt, watermark.id]);
}

function hasUnusableContinuation({
  lane,
  response,
}: FetchedContainerParentLanePage): boolean {
  const next = response.nextWatermark;
  if (!next) return response.hasMore;
  // Opaque positions can advance with an older business timestamp.
  // A drained lane may echo its current position, but never an earlier one.
  if (
    next.id === lane.watermark?.id &&
    next.updatedAt === lane.watermark.updatedAt
  )
    return response.hasMore;
  return lane.continuationCursors?.has(cursorKey(next)) === true;
}

function queueNextPage(
  { lane, response }: FetchedContainerParentLanePage,
  skipWatermarkWrite: boolean,
  queueContinuationLane: (lane: ContainerParentHydrationLane) => void,
): void {
  if (response.hasMore && response.nextWatermark) {
    const continuationCursors = lane.continuationCursors ?? new Set<string>();
    if (lane.watermark) continuationCursors.add(cursorKey(lane.watermark));
    continuationCursors.add(cursorKey(response.nextWatermark));
    queueContinuationLane({
      parentId: lane.parentId,
      watermark: response.nextWatermark,
      skipWatermarkWrite,
      continuationCursors,
    });
  }
}

async function checkpointPage(input: {
  reconnect?: ReconnectPages | undefined;
  fetchedPage: FetchedContainerParentLanePage;
  isCurrent?: (() => boolean) | undefined;
  state: RemoteContainerHydrationState;
}): Promise<boolean> {
  const { lane, response, syncLane } = input.fetchedPage;
  // Only a drained chain can advance a reconnect checkpoint. Otherwise a
  // cycle can alternate the durable cursor between successive attempts.
  if (input.reconnect && response.hasMore) return true;
  const nextWatermark =
    response.nextWatermark ??
    (lane.continuationCursors ? (lane.watermark ?? null) : null);
  return markContainerParentLaneFetched({
    isCurrent: input.isCurrent,
    response: { ...response, nextWatermark },
    state: input.state,
    syncLane,
  });
}

async function applyContainerParentLanePage(input: {
  reconnect?: ReconnectPages | undefined;
  childIdsByParentId: ContainerChildIndex;
  fetchedPage: FetchedContainerParentLanePage;
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  policyOperation: PrincipalPolicyOperation;
  queueContinuationLane: (lane: ContainerParentHydrationLane) => void;
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: RemoteContainerHydrationState;
}): Promise<HydrationProgress> {
  const {
    childIdsByParentId,
    fetchedPage,
    host,
    queueContinuationLane,
    queueParentLane,
    seenContainerIds,
    state,
  } = input;
  const {
    expectedContainerStates,
    expectedHydrationTombstones,
    lane,
    response,
  } = fetchedPage;
  let changedCount = 0;
  if (input.isCurrent?.() === false) {
    return { changedCount, outcome: "retry", shouldStop: true };
  }

  const remoteContainerItems = getApplicableRemoteContainerItems(response);
  const tombstoneResult = await applyContainerTombstones({
    childIdsByParentId,
    expectedContainerStates,
    isCurrent: input.isCurrent,
    remoteContainerItems,
    response,
    state,
  });
  if (!tombstoneResult.current) {
    return { changedCount, outcome: "retry", shouldStop: true };
  }
  changedCount += tombstoneResult.changedCount;
  if (input.isCurrent?.() === false) {
    return { changedCount, outcome: "retry", shouldStop: true };
  }
  if (tombstoneResult.changedCount > 0) {
    // A live tombstone cascade may have orphaned documents (row 3); re-arm
    // document priming so their null-scoped passes run now rather than on
    // the next startup.
    host.requestDocumentPriming?.();
  }

  // A paused organization's containers stay as the device last saw them.
  // Skipping them here, after tombstones saw the full page, still lets the
  // lane complete and its watermark advance; their children are never queued.
  const isPaused = await loadPausedContainerFilter(state);
  const appliedPage = await applyRemoteContainerPage({
    reconnect: input.reconnect,
    childIdsByParentId,
    expectedContainerStates,
    expectedHydrationTombstones,
    host,
    isCurrent: input.isCurrent,
    isPaused,
    items: remoteContainerItems.filter((item) => !isPaused(item)),
    policyOperation: input.policyOperation,
    queueParentLane,
    seenContainerIds,
    state,
  });
  changedCount += appliedPage.changedCount;
  const outcome = tombstoneResult.completed ? appliedPage.outcome : "retry";
  if (input.isCurrent?.() === false) {
    return { changedCount, outcome: "retry", shouldStop: true };
  }
  // A bad continuation invalidates the cursor, independently verified rows still apply.
  if (hasUnusableContinuation(fetchedPage))
    return { changedCount, outcome: "retry", shouldStop: false };
  // A refused item leaves a gap in this lane. Later pages can still discover
  // independent children, but none may move its durable cursor past the gap.
  if (outcome !== "complete" && !input.reconnect)
    return { changedCount, outcome, shouldStop: false };
  const skipWatermarkWrite = lane.skipWatermarkWrite || outcome !== "complete";
  if (!skipWatermarkWrite && !(await checkpointPage(input))) {
    return { changedCount, outcome: "retry", shouldStop: true };
  }

  queueNextPage(fetchedPage, skipWatermarkWrite, queueContinuationLane);
  return { changedCount, outcome, shouldStop: false };
}

function takeContainerParentLaneBatch(input: {
  lanes: ContainerParentHydrationLane[];
  state: RemoteContainerHydrationState;
}): ContainerParentHydrationLane[] {
  const { lanes, state } = input;
  const batch: ContainerParentHydrationLane[] = [];

  while (
    lanes.length > 0 &&
    batch.length < CONTAINER_PARENT_HYDRATION_CONCURRENCY
  ) {
    const lane = lanes.shift();
    if (
      lane &&
      (lane.parentId === null || state.containersById.has(lane.parentId))
    ) {
      batch.push(lane);
    }
  }

  return batch;
}

async function applyContainerParentLaneBatch(input: {
  reconnect?: ReconnectPages | undefined;
  childIdsByParentId: ContainerChildIndex;
  fetchedPages: ReadonlyArray<FetchedContainerParentLanePage>;
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  lanes: ContainerParentHydrationLane[];
  policyOperation: PrincipalPolicyOperation;
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: RemoteContainerHydrationState;
}): Promise<HydrationProgress> {
  const {
    childIdsByParentId,
    fetchedPages,
    host,
    lanes,
    queueParentLane,
    seenContainerIds,
    state,
  } = input;
  let changedCount = 0;
  let outcome: HydrationOutcome = "complete";

  for (const fetchedPage of fetchedPages) {
    if (!canHydrateRemoteContainers(state) || input.isCurrent?.() === false) {
      return { changedCount, outcome: "retry", shouldStop: true };
    }
    if (
      fetchedPage.lane.parentId !== null &&
      !state.containersById.has(fetchedPage.lane.parentId)
    ) {
      continue;
    }

    const result = await applyContainerParentLanePage({
      reconnect: input.reconnect,
      childIdsByParentId,
      fetchedPage,
      host,
      isCurrent: input.isCurrent,
      policyOperation: input.policyOperation,
      queueContinuationLane: (lane) => lanes.push(lane),
      queueParentLane,
      seenContainerIds,
      state,
    });
    changedCount += result.changedCount;
    outcome = combineOutcomes(outcome, result.outcome);

    if (result.shouldStop) {
      return { changedCount, outcome: "retry", shouldStop: true };
    }
  }

  return { changedCount, outcome, shouldStop: false };
}

export async function hydrateContainerParentLanes(input: {
  reconnect?: ReconnectPages | undefined;
  childIdsByParentId: ContainerChildIndex;
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  lanes: ContainerParentHydrationLane[];
  queueParentLane: QueueContainerParentLane;
  seenContainerIds: Set<string>;
  state: RemoteContainerHydrationState;
}): Promise<HydrationProgress> {
  const {
    childIdsByParentId,
    host,
    lanes,
    queueParentLane,
    seenContainerIds,
    state,
  } = input;
  let changedCount = 0;
  let outcome: HydrationOutcome = "complete";
  // One hydration pass is one policy operation: its pages share a discovery.
  const policyOperation = createPrincipalPolicyOperation();

  while (lanes.length > 0) {
    if (!canHydrateRemoteContainers(state) || input.isCurrent?.() === false) {
      return { changedCount, outcome: "retry", shouldStop: true };
    }

    const batch = takeContainerParentLaneBatch({ lanes, state });
    if (batch.length === 0) {
      continue;
    }

    const fetchedPages = await fetchContainerParentLaneBatch({
      batch,
      laneIdPrefix: input.reconnect?.laneIdPrefix,
      isCurrent: input.isCurrent,
      state,
    });
    if (!fetchedPages) {
      return { changedCount, outcome: "retry", shouldStop: true };
    }
    if (input.isCurrent?.() === false) {
      return { changedCount, outcome: "retry", shouldStop: true };
    }

    const result = await applyContainerParentLaneBatch({
      reconnect: input.reconnect,
      childIdsByParentId,
      fetchedPages,
      host,
      isCurrent: input.isCurrent,
      lanes,
      policyOperation,
      queueParentLane,
      seenContainerIds,
      state,
    });
    changedCount += result.changedCount;
    outcome = combineOutcomes(outcome, result.outcome);

    if (result.shouldStop) {
      return { changedCount, outcome: "retry", shouldStop: true };
    }
  }

  return { changedCount, outcome, shouldStop: false };
}

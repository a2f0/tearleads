import { organizationRosterProfileContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { MAX_CONTAINER_PARENT_LANES } from "@tearleads/validators/request";
import {
  createPrincipalPolicyOperation,
  type PrincipalPolicyOperation,
} from "../../../principals/principalPolicyService";
import { changesDiscoveryOrder } from "../../documentDiscovery/publicationWatermark";
import { markContainerParentLaneFetched } from "../lanes/laneFetchMarkers";
import { fetchContainerParentLaneBatch } from "../lanes/parentLaneFetch";
import {
  hasUnusableContinuation,
  queueNextPage,
} from "../lanes/parentLanePaging";
import {
  applyContainerTombstones,
  getApplicableRemoteContainerItems,
} from "../tombstoneApplication";
import type {
  ContainerChildIndex,
  ContainerParentHydrationLane,
  FetchedContainerParentLanePage,
  FetchedContainerParentLaneResult,
  HydrationOutcome,
  ListedRemoteContainerPageItem,
  QueueContainerParentLane,
  ReconnectPages,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
} from "../types";
import {
  applyIdsOnlyParentLanePage,
  type RootLaneMembershipSweep,
} from "./applyIdsOnlyParentLanePage";
import {
  applyRemoteContainerPage,
  combineHydrationOutcomes as combineOutcomes,
} from "./applyRemoteContainerPage";
import { loadPausedContainerFilter } from "./organizationSyncPauseFilter";

/** Parent lanes one crawl request lists: as many as the server accepts. */
const CONTAINER_PARENT_LANES_PER_REQUEST = MAX_CONTAINER_PARENT_LANES;

interface HydrationProgress {
  changedCount: number;
  outcome: HydrationOutcome;
  shouldStop: boolean;
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

/**
 * The server republishes a container's row with every write that changes
 * what its document lane returns, so each row a lane serves past its
 * watermark owes that container's lane a listing. They are owed before a row
 * is applied or the watermark passes it, paused folders included: their rows
 * pass the watermark too. A membership listing serves every row the lane
 * holds, moved or not, and owes nothing. Returns whether the hydration is
 * still current.
 */
async function oweServedDocumentLanes(
  input: {
    fetchedPage: FetchedContainerParentLanePage;
    host: RemoteContainerHydrationHost;
    isCurrent?: (() => boolean) | undefined;
  },
  served: ReadonlyArray<
    Pick<ListedRemoteContainerPageItem, "id" | "organizationId" | "systemSlot">
  >,
): Promise<boolean> {
  if (input.fetchedPage.lane.membershipOnly) return true;
  // Roster profile containers never return rows from document listings, so
  // owing their document lane on tree hydration only causes wasted queries.
  const listable = served.filter(
    (item) =>
      !item.systemSlot ||
      !item.organizationId ||
      item.systemSlot !==
        organizationRosterProfileContainerSystemSlot(item.organizationId),
  );
  await input.host.requestDocumentLaneListings?.(
    listable.map((item) => item.id),
  );
  return input.isCurrent?.() !== false;
}

function recordFullRootPageMembership(
  rootMembership: RootLaneMembershipSweep,
  lane: ContainerParentHydrationLane,
  response: FetchedContainerParentLanePage["response"],
  outcome: HydrationOutcome,
): void {
  if (lane.parentId !== null || lane.watermark !== null) return;
  for (const item of response.items) {
    rootMembership.observedIds.add(item.id);
  }
  if (!response.hasMore && outcome === "complete") {
    rootMembership.complete = true;
  }
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
  rootMembership: RootLaneMembershipSweep;
  seenContainerObservations: Map<string, string>;
  state: RemoteContainerHydrationState;
}): Promise<HydrationProgress> {
  const { childIdsByParentId, fetchedPage, host, state } = input;
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

  if (
    changesDiscoveryOrder(
      lane.watermark,
      response.nextWatermark,
      !!lane.continuationCursors,
    )
  )
    return { changedCount, outcome: "retry", shouldStop: false };
  const remoteContainerItems = getApplicableRemoteContainerItems(response);
  const isPaused = await loadPausedContainerFilter(state);
  const tombstoneResult = await applyContainerTombstones({
    isPaused,
    parentId: lane.parentId,
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
    // Prime documents orphaned by this cascade during the current pass.
    host.requestDocumentPriming?.();
  }

  if (!(await oweServedDocumentLanes(input, remoteContainerItems))) {
    return { changedCount, outcome: "retry", shouldStop: true };
  }

  // Paused folders keep their local state while the lane advances.
  const appliedPage = await applyRemoteContainerPage({
    reconnect: input.reconnect,
    childIdsByParentId,
    expectedContainerStates,
    expectedHydrationTombstones,
    host,
    isCurrent: input.isCurrent,
    isPaused,
    isRootLane: lane.parentId === null,
    items: remoteContainerItems.filter((item) => !isPaused(item)),
    policyOperation: input.policyOperation,
    queueParentLane: input.queueParentLane,
    seenContainerObservations: input.seenContainerObservations,
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
  recordFullRootPageMembership(input.rootMembership, lane, response, outcome);

  queueNextPage(fetchedPage, skipWatermarkWrite, input.queueContinuationLane);
  return { changedCount, outcome, shouldStop: false };
}

function takeContainerParentLaneBatch(input: {
  lanes: ContainerParentHydrationLane[];
  state: RemoteContainerHydrationState;
  unmarkSkippedParentLane?: ((parentId: string | null) => void) | undefined;
}): ContainerParentHydrationLane[] {
  const { lanes, state, unmarkSkippedParentLane } = input;
  const batch: ContainerParentHydrationLane[] = [];

  while (
    lanes.length > 0 &&
    batch.length < CONTAINER_PARENT_LANES_PER_REQUEST
  ) {
    const lane = lanes.shift();
    if (!lane) continue;
    if (lane.parentId === null || state.containersById.has(lane.parentId)) {
      batch.push(lane);
    } else {
      // A hint can name an unlisted child before its parent lane hydrates it;
      // release its dedupe slot so parent discovery can queue it immediately.
      unmarkSkippedParentLane?.(lane.parentId);
    }
  }

  return batch;
}

function collectRootLaneMemberChanges(
  containersById: RemoteContainerHydrationState["containersById"],
  observedIds: ReadonlySet<string>,
): { readonly addIds: string[]; readonly removeIds: string[] } {
  const addIds: string[] = [];
  const removeIds: string[] = [];
  for (const [id, { container }] of containersById) {
    if (container.parentId === null || container.serverCreatedAt == null) {
      continue;
    }
    const isMember = observedIds.has(id);
    if (isMember && container.rootLaneMember !== true) addIds.push(id);
    else if (!isMember && container.rootLaneMember === true) removeIds.push(id);
  }
  return { addIds, removeIds };
}

function applyRootLaneMemberChangeInMemory(
  containersById: RemoteContainerHydrationState["containersById"],
  ids: readonly string[],
  nextValue: true | undefined,
): number {
  let updated = 0;
  for (const id of ids) {
    const current = containersById.get(id);
    if (!current || current.container.rootLaneMember === nextValue) continue;
    current.container = { ...current.container, rootLaneMember: nextValue };
    updated++;
  }
  return updated;
}

async function reconcileRootLaneMembers(input: {
  readonly isCurrent?: (() => boolean) | undefined;
  readonly rootMembership: RootLaneMembershipSweep;
  readonly state: RemoteContainerHydrationState;
}): Promise<number> {
  if (!input.rootMembership.complete || input.isCurrent?.() === false) return 0;
  const { addIds, removeIds } = collectRootLaneMemberChanges(
    input.state.containersById,
    input.rootMembership.observedIds,
  );
  if (addIds.length === 0 && removeIds.length === 0) return 0;
  await input.state.persistence.setRootLaneMembers?.(
    input.state.runtime.infra.execSql,
    { addIds, removeIds },
  );
  if (input.isCurrent?.() === false) return 0;
  return (
    applyRootLaneMemberChangeInMemory(
      input.state.containersById,
      addIds,
      true,
    ) +
    applyRootLaneMemberChangeInMemory(
      input.state.containersById,
      removeIds,
      undefined,
    )
  );
}

async function applyFetchedParentLaneResult(input: {
  reconnect?: ReconnectPages | undefined;
  childIdsByParentId: ContainerChildIndex;
  fetchedPage: FetchedContainerParentLaneResult;
  fullRootFallbackQueued: { queued: boolean };
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  lanes: ContainerParentHydrationLane[];
  policyOperation: PrincipalPolicyOperation;
  queueParentLane: QueueContainerParentLane;
  rootMembership: RootLaneMembershipSweep;
  seenContainerObservations: Map<string, string>;
  state: RemoteContainerHydrationState;
}): Promise<HydrationProgress> {
  const { fetchedPage, lanes } = input;
  if (fetchedPage.kind === "failure") {
    // One failing lane leaves only that lane retryable; siblings still apply.
    return { changedCount: 0, outcome: "retry", shouldStop: false };
  }
  if (fetchedPage.kind === "idsPage") {
    const idsResult = await applyIdsOnlyParentLanePage({
      fetchedPage,
      fullRootFallbackQueued: input.fullRootFallbackQueued,
      isCurrent: input.isCurrent,
      queueContinuationLane: (lane) => lanes.push(lane),
      rootMembership: input.rootMembership,
      state: input.state,
    });
    return { changedCount: 0, ...idsResult };
  }
  return applyContainerParentLanePage({
    reconnect: input.reconnect,
    childIdsByParentId: input.childIdsByParentId,
    fetchedPage,
    host: input.host,
    isCurrent: input.isCurrent,
    policyOperation: input.policyOperation,
    queueContinuationLane: (lane) => lanes.push(lane),
    queueParentLane: input.queueParentLane,
    rootMembership: input.rootMembership,
    seenContainerObservations: input.seenContainerObservations,
    state: input.state,
  });
}

async function applyContainerParentLaneBatch(input: {
  reconnect?: ReconnectPages | undefined;
  childIdsByParentId: ContainerChildIndex;
  fetchedPages: ReadonlyArray<FetchedContainerParentLaneResult>;
  fullRootFallbackQueued: { queued: boolean };
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  lanes: ContainerParentHydrationLane[];
  policyOperation: PrincipalPolicyOperation;
  queueParentLane: QueueContainerParentLane;
  rootMembership: RootLaneMembershipSweep;
  seenContainerObservations: Map<string, string>;
  state: RemoteContainerHydrationState;
}): Promise<HydrationProgress> {
  let changedCount = 0;
  let outcome: HydrationOutcome = "complete";

  for (const fetchedPage of input.fetchedPages) {
    if (
      !canHydrateRemoteContainers(input.state) ||
      input.isCurrent?.() === false
    ) {
      return { changedCount, outcome: "retry", shouldStop: true };
    }
    if (
      fetchedPage.lane.parentId !== null &&
      !input.state.containersById.has(fetchedPage.lane.parentId)
    ) {
      continue;
    }

    const result = await applyFetchedParentLaneResult({
      ...input,
      fetchedPage,
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
  seenContainerObservations: Map<string, string>;
  state: RemoteContainerHydrationState;
  unmarkSkippedParentLane?: ((parentId: string | null) => void) | undefined;
}): Promise<HydrationProgress> {
  const {
    childIdsByParentId,
    host,
    lanes,
    queueParentLane,
    seenContainerObservations,
    state,
    unmarkSkippedParentLane,
  } = input;
  let changedCount = 0;
  let outcome: HydrationOutcome = "complete";
  // One hydration pass is one policy operation: its pages share a discovery.
  const policyOperation = createPrincipalPolicyOperation();
  const fullRootFallbackQueued = { queued: false };
  const rootMembership: RootLaneMembershipSweep = {
    complete: false,
    observedIds: new Set(),
  };

  while (lanes.length > 0) {
    if (!canHydrateRemoteContainers(state) || input.isCurrent?.() === false) {
      return { changedCount, outcome: "retry", shouldStop: true };
    }

    const batch = takeContainerParentLaneBatch({
      lanes,
      state,
      unmarkSkippedParentLane,
    });
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
      fullRootFallbackQueued,
      host,
      isCurrent: input.isCurrent,
      lanes,
      policyOperation,
      queueParentLane,
      rootMembership,
      seenContainerObservations,
      state,
    });
    changedCount += result.changedCount;
    outcome = combineOutcomes(outcome, result.outcome);

    if (result.shouldStop) {
      return { changedCount, outcome: "retry", shouldStop: true };
    }
  }

  changedCount += await reconcileRootLaneMembers({
    isCurrent: input.isCurrent,
    rootMembership,
    state,
  });

  return { changedCount, outcome, shouldStop: false };
}

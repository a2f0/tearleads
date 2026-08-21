import {
  type ContainerContentsPersistence,
  createContainerParentSyncLane,
  loadContainerSyncLaneCheckRecords,
} from "../../workflows/container-contents/containerPersistence";
import { hasStartupDocumentSyncWork } from "../../workflows/container-contents/documentPriming";
import { isDatabaseUnavailableError } from "../../workflows/container-contents/syncLane";

const STARTUP_REMOTE_HYDRATION_FRESH_MS = 15 * 60_000;
type StartupHydrationExecSql = Parameters<
  typeof loadContainerSyncLaneCheckRecords
>[0];

interface StartupHydrationState {
  containerParentIdsNeedingHydration: Set<string | null>;
  containersById: ReadonlyMap<
    string,
    {
      container: {
        metadataDocumentId?: string | null | undefined;
        parentId: string | null;
      };
    }
  >;
  rootLaneHydrated: boolean;
  runtime: {
    auth: { isAuthenticated: boolean };
    infra: { execSql: StartupHydrationExecSql };
    state: { containerId: string | null; online: boolean };
  };
}

function isFreshStartupRemoteHydrationCheck(
  checkedAt: string,
  nowMs: number,
): boolean {
  const checkedAtMs = Date.parse(checkedAt);
  return (
    Number.isFinite(checkedAtMs) &&
    nowMs - checkedAtMs <= STARTUP_REMOTE_HYDRATION_FRESH_MS
  );
}

function shouldHydrateUnmarkedStartupRoot(
  state: StartupHydrationState,
): boolean {
  // An empty authenticated cache needs one root probe to discover the remote
  // tree. Existing local-only roots are deliberately left cache-first; explicit
  // refresh and remote events can reconcile them without polling every startup.
  return state.containersById.size === 0;
}

async function getStaleStartupRemoteHydrationParentIds(
  state: StartupHydrationState,
  isCurrent?: (() => boolean) | undefined,
): Promise<Array<string | null> | null> {
  const parentIds = [null, ...state.containersById.keys()];
  const syncLanes = parentIds.map((parentId) =>
    createContainerParentSyncLane(parentId),
  );
  const checkRecords = await loadContainerSyncLaneCheckRecords(
    state.runtime.infra.execSql,
    syncLanes,
  );
  if (isCurrent?.() === false) {
    return null;
  }
  const nowMs = Date.now();
  const rootCheckRecord = checkRecords[0];
  state.rootLaneHydrated = rootCheckRecord
    ? isFreshStartupRemoteHydrationCheck(rootCheckRecord.checkedAt, nowMs)
    : false;
  const hydrateUnmarkedRoot = shouldHydrateUnmarkedStartupRoot(state);

  return parentIds.filter((_, index) => {
    const checkRecord = checkRecords[index];
    if (!checkRecord) {
      return hydrateUnmarkedRoot && index === 0;
    }

    return !isFreshStartupRemoteHydrationCheck(checkRecord.checkedAt, nowMs);
  });
}

function reportStartupHydrationError(message: string, error: unknown) {
  if (isDatabaseUnavailableError(error)) {
    return;
  }

  console.error(message, error);
}

export async function scheduleStaleStartupRemoteHydration(input: {
  isCurrent?: (() => boolean) | undefined;
  requestHydration: () => Promise<void>;
  state: StartupHydrationState;
}): Promise<boolean> {
  const { requestHydration, state } = input;
  if (!state.runtime.auth.isAuthenticated || !state.runtime.state.online) {
    return false;
  }

  let parentIds: Array<string | null> | null;
  try {
    parentIds = await getStaleStartupRemoteHydrationParentIds(
      state,
      input.isCurrent,
    );
  } catch (error: unknown) {
    reportStartupHydrationError(
      "Failed to inspect startup container contents hydration:",
      error,
    );
    return false;
  }
  if (!parentIds || input.isCurrent?.() === false) {
    return false;
  }
  const activeContainerId = state.runtime.state.containerId;
  const shouldScheduleStaleRootRecovery =
    state.rootLaneHydrated &&
    activeContainerId !== null &&
    !state.containersById.has(activeContainerId);
  if (parentIds.length === 0) {
    return shouldScheduleStaleRootRecovery;
  }

  for (const parentId of parentIds) {
    state.containerParentIdsNeedingHydration.add(parentId);
  }
  // Startup stays cache-first: only the local freshness-marker read is awaited.
  // Missing markers on an existing remote cache do not force a first-open poll;
  // stale checked lanes and empty caches hydrate behind the cached tree.
  // WebSocket events and explicit refresh bypass this.
  void requestHydration().catch((error: unknown) => {
    reportStartupHydrationError(
      "Failed to schedule startup container contents hydration:",
      error,
    );
  });
  return shouldScheduleStaleRootRecovery;
}

export async function hasStartupContainerSyncWork(state: {
  containersById: ReadonlyMap<string, unknown>;
  persistence: ContainerContentsPersistence;
  runtime: { infra: { execSql: StartupHydrationExecSql } };
}): Promise<boolean> {
  const execSql = state.runtime.infra.execSql;
  const [createIntents, moveIntents] = await Promise.all([
    state.persistence.listPendingCreateIntents(execSql),
    state.persistence.listUnsyncedMoveIntents(execSql),
  ]);
  if (createIntents.length > 0 || moveIntents.length > 0) {
    return true;
  }

  // Durable document-level work (pending creates, queued Loro updates or
  // attachments, pending document move intents) is drained by lane passes too:
  // the pass primes the owning document stores, which register and request
  // their own sync lanes. Without this probe, a relaunch whose only pending
  // work is document-level never schedules any lane and the write queue sits
  // unattempted forever.
  if (await hasStartupDocumentSyncWork(execSql)) {
    return true;
  }

  const containerIds = Array.from(state.containersById.keys());
  if (containerIds.length === 0) {
    return false;
  }
  const containersWithPendingMetadata =
    await state.persistence.listContainerIdsWithPendingUpdates(
      execSql,
      containerIds,
    );
  return containersWithPendingMetadata.length > 0;
}

import { getContainerContentsStoreLogLabel } from "./logLabel";
import {
  type RemoteHydrationRequester,
  refreshAllRemoteHydration,
} from "./remoteHydrationRefresh";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

type DormantMetadataSweep = Awaited<
  ReturnType<
    ContainerContentsStoreSyncState["persistence"]["listDormantMetadataSweepRequests"]
  >
>[number];
type DeletionProbeResult = "deleted" | "preserved" | "retry";

const DELETION_PROBE_CONCURRENCY = 4;
const SWEEP_ATTEMPT_LIMIT = 5;
const SWEEP_RETRY_BASE_MS = 60_000;
const SWEEP_RETRY_MAX_MS = 15 * 60_000;

function isSweepAttemptDue(sweep: DormantMetadataSweep, now: number): boolean {
  if (!sweep.lastAttemptedAt) {
    return true;
  }
  const lastAttemptedAt = Date.parse(sweep.lastAttemptedAt);
  if (!Number.isFinite(lastAttemptedAt)) {
    return true;
  }
  const retryDelay = Math.min(
    SWEEP_RETRY_BASE_MS * 2 ** Math.max(0, sweep.attemptCount - 1),
    SWEEP_RETRY_MAX_MS,
  );
  return lastAttemptedAt + retryDelay <= now;
}

async function probeContainerDeletion(
  state: ContainerContentsStoreSyncState,
  containerId: string,
): Promise<DeletionProbeResult> {
  // A cached success can predate revocation. Evict it so this request is a
  // fresh server-side existence proof made after the full restoration crawl.
  state.runtime.apiClient.evictContainerWriterProjection(containerId);
  const result =
    await state.runtime.apiClient.getContainerWriterProjectionResult(
      containerId,
      { reportErrors: false },
    );
  if (!result.ok && result.kind === "http" && result.status === 404) {
    return "deleted";
  }
  if (!result.ok && result.status !== 403) {
    return "retry";
  }
  // A 403 means the container is live but still unavailable (including a
  // read-only grant), so its edits stay dormant. A success is equally live.
  return "preserved";
}

async function proveDeletedContainerIds(
  state: ContainerContentsStoreSyncState,
  sweep: DormantMetadataSweep,
): Promise<{ deletedContainerIds: string[]; shouldRetry: boolean }> {
  const deletedContainerIds: string[] = [];
  let afterContainerId: string | undefined;
  let shouldRetry = false;

  while (true) {
    const candidates =
      await state.persistence.listDormantMetadataSweepCandidates(
        state.runtime.infra.execSql,
        sweep,
        afterContainerId,
      );
    if (candidates.length === 0) {
      return { deletedContainerIds, shouldRetry };
    }

    for (
      let offset = 0;
      offset < candidates.length;
      offset += DELETION_PROBE_CONCURRENCY
    ) {
      const batch = candidates.slice(
        offset,
        offset + DELETION_PROBE_CONCURRENCY,
      );
      const results = await Promise.all(
        batch.map((containerId) => probeContainerDeletion(state, containerId)),
      );
      deletedContainerIds.push(
        ...batch.filter((_containerId, index) => results[index] === "deleted"),
      );
      // Inconclusive answers retain the durable request for a later natural
      // trigger; the restoration crawl itself is forbidden from re-arming.
      shouldRetry ||= results.includes("retry");
    }

    afterContainerId = candidates.at(-1);
  }
}

async function completeRestorationSweeps(
  state: ContainerContentsStoreSyncState,
  sweeps: readonly DormantMetadataSweep[],
): Promise<void> {
  for (const sweep of sweeps) {
    const { deletedContainerIds, shouldRetry } = await proveDeletedContainerIds(
      state,
      sweep,
    );
    const purgedCount =
      await state.persistence.purgeDormantContainerMetadataCandidates(
        state.runtime.infra.execSql,
        sweep,
        deletedContainerIds,
      );
    if (purgedCount > 0) {
      state.runtime.util.log(
        `${getContainerContentsStoreLogLabel(state)}: purged ${purgedCount} dormant metadata document(s) after access restoration`,
      );
    }
    if (shouldRetry) {
      if (sweep.attemptCount >= SWEEP_ATTEMPT_LIMIT) {
        await state.persistence.completeDormantMetadataSweepRequest(
          state.runtime.infra.execSql,
          sweep,
        );
        state.runtime.util.log(
          `${getContainerContentsStoreLogLabel(state)}: stopped dormant metadata sweep after ${sweep.attemptCount} inconclusive attempts; metadata remains dormant`,
        );
        continue;
      }
      state.runtime.util.log(
        `${getContainerContentsStoreLogLabel(state)}: deferred dormant metadata sweep after an inconclusive deletion probe`,
      );
      continue;
    }
    await state.persistence.completeDormantMetadataSweepRequest(
      state.runtime.infra.execSql,
      sweep,
    );
  }
}

async function claimDueRestorationSweeps(
  state: ContainerContentsStoreSyncState,
  sweeps: readonly DormantMetadataSweep[],
): Promise<DormantMetadataSweep[]> {
  const now = Date.now();
  const attemptedAt = new Date(now).toISOString();
  const claimed: DormantMetadataSweep[] = [];
  for (const sweep of sweeps) {
    if (sweep.attemptCount >= SWEEP_ATTEMPT_LIMIT) {
      await state.persistence.completeDormantMetadataSweepRequest(
        state.runtime.infra.execSql,
        sweep,
      );
      state.runtime.util.log(
        `${getContainerContentsStoreLogLabel(state)}: retired exhausted dormant metadata sweep; metadata remains dormant`,
      );
      continue;
    }
    if (!isSweepAttemptDue(sweep, now)) {
      continue;
    }
    const didClaim = await state.persistence.claimDormantMetadataSweepAttempt(
      state.runtime.infra.execSql,
      sweep,
      attemptedAt,
    );
    if (didClaim) {
      claimed.push({
        ...sweep,
        attemptCount: sweep.attemptCount + 1,
        lastAttemptedAt: attemptedAt,
      });
    }
  }
  return claimed;
}

async function reconcileRestoredAccess(input: {
  requestHydration: RemoteHydrationRequester;
  state: ContainerContentsStoreSyncState;
}): Promise<void> {
  const { requestHydration, state } = input;
  const requesterUserId = state.runtime.auth.userId;
  if (!requesterUserId) {
    return;
  }
  const pendingSweeps =
    await state.persistence.listDormantMetadataSweepRequests(
      state.runtime.infra.execSql,
      requesterUserId,
    );
  const sweeps = await claimDueRestorationSweeps(state, pendingSweeps);
  if (sweeps.length === 0) {
    return;
  }

  await refreshAllRemoteHydration({
    onFullyHydrated: () => completeRestorationSweeps(state, sweeps),
    requestHydration,
    resetAllLaneWatermarks: true,
    scheduleSyncAfterHydration: false,
    scheduleSyncOnHydrationChange: false,
    state,
  });
}

export function createRestoredAccessReconciler(input: {
  requestHydration: RemoteHydrationRequester;
  state: ContainerContentsStoreSyncState;
}): () => Promise<void> {
  const { state } = input;
  return async () => {
    try {
      await reconcileRestoredAccess(input);
    } catch (error) {
      const message = `${getContainerContentsStoreLogLabel(state)}: dormant metadata sweep failed`;
      if (state.runtime.util.logError) {
        state.runtime.util.logError(message, error);
      } else {
        state.runtime.util.log(message);
      }
    }
  };
}

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

interface RestorationSweepSession {
  isCurrent: () => boolean;
  persistence: ContainerContentsStoreSyncState["persistence"];
  runtime: ContainerContentsStoreSyncState["runtime"];
  state: ContainerContentsStoreSyncState;
}

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
  session: RestorationSweepSession,
  containerId: string,
): Promise<DeletionProbeResult> {
  if (!session.isCurrent()) {
    return "retry";
  }
  // A cached success can predate revocation. Evict it so this request is a
  // fresh server-side existence proof made after the full restoration crawl.
  session.runtime.apiClient.evictContainerWriterProjection(containerId);
  const result =
    await session.runtime.apiClient.getContainerWriterProjectionResult(
      containerId,
      { reportErrors: false },
    );
  if (!session.isCurrent()) {
    return "retry";
  }
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
  session: RestorationSweepSession,
  sweep: DormantMetadataSweep,
): Promise<{
  cancelled: boolean;
  deletedContainerIds: string[];
  shouldRetry: boolean;
}> {
  const deletedContainerIds: string[] = [];
  let afterContainerId: string | undefined;
  let shouldRetry = false;

  while (true) {
    if (!session.isCurrent()) {
      return { cancelled: true, deletedContainerIds, shouldRetry };
    }
    const candidates =
      await session.persistence.listDormantMetadataSweepCandidates(
        session.runtime.infra.execSql,
        sweep,
        afterContainerId,
      );
    if (!session.isCurrent()) {
      return { cancelled: true, deletedContainerIds, shouldRetry };
    }
    if (candidates.length === 0) {
      return { cancelled: false, deletedContainerIds, shouldRetry };
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
        batch.map((containerId) =>
          probeContainerDeletion(session, containerId),
        ),
      );
      if (!session.isCurrent()) {
        return { cancelled: true, deletedContainerIds, shouldRetry };
      }
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
  session: RestorationSweepSession,
  sweeps: readonly DormantMetadataSweep[],
): Promise<void> {
  for (const sweep of sweeps) {
    if (!session.isCurrent()) {
      return;
    }
    const { cancelled, deletedContainerIds, shouldRetry } =
      await proveDeletedContainerIds(session, sweep);
    if (cancelled || !session.isCurrent()) {
      return;
    }
    const purgedCount =
      await session.persistence.purgeDormantContainerMetadataCandidates(
        session.runtime.infra.execSql,
        sweep,
        deletedContainerIds,
      );
    if (!session.isCurrent()) {
      return;
    }
    if (purgedCount > 0) {
      session.runtime.util.log(
        `${getContainerContentsStoreLogLabel(session.state)}: purged ${purgedCount} dormant metadata document(s) after access restoration`,
      );
    }
    if (shouldRetry) {
      if (sweep.attemptCount >= SWEEP_ATTEMPT_LIMIT) {
        await session.persistence.completeDormantMetadataSweepRequest(
          session.runtime.infra.execSql,
          sweep,
        );
        if (!session.isCurrent()) {
          return;
        }
        session.runtime.util.log(
          `${getContainerContentsStoreLogLabel(session.state)}: stopped dormant metadata sweep after ${sweep.attemptCount} inconclusive attempts; metadata remains dormant`,
        );
        continue;
      }
      session.runtime.util.log(
        `${getContainerContentsStoreLogLabel(session.state)}: deferred dormant metadata sweep after an inconclusive deletion probe`,
      );
      continue;
    }
    await session.persistence.completeDormantMetadataSweepRequest(
      session.runtime.infra.execSql,
      sweep,
    );
  }
}

async function claimDueRestorationSweeps(
  session: RestorationSweepSession,
  sweeps: readonly DormantMetadataSweep[],
): Promise<DormantMetadataSweep[]> {
  const now = Date.now();
  const attemptedAt = new Date(now).toISOString();
  const claimed: DormantMetadataSweep[] = [];
  for (const sweep of sweeps) {
    if (!session.isCurrent()) {
      return claimed;
    }
    if (sweep.attemptCount >= SWEEP_ATTEMPT_LIMIT) {
      await session.persistence.completeDormantMetadataSweepRequest(
        session.runtime.infra.execSql,
        sweep,
      );
      if (!session.isCurrent()) {
        return claimed;
      }
      session.runtime.util.log(
        `${getContainerContentsStoreLogLabel(session.state)}: retired exhausted dormant metadata sweep; metadata remains dormant`,
      );
      continue;
    }
    if (!isSweepAttemptDue(sweep, now)) {
      continue;
    }
    const didClaim = await session.persistence.claimDormantMetadataSweepAttempt(
      session.runtime.infra.execSql,
      sweep,
      attemptedAt,
    );
    if (!session.isCurrent()) {
      return claimed;
    }
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
  lifecycleGeneration: number;
  requestHydration: RemoteHydrationRequester;
  state: ContainerContentsStoreSyncState;
}): Promise<void> {
  const { requestHydration, state } = input;
  const session: RestorationSweepSession = {
    isCurrent: () => state.lifecycleGeneration === input.lifecycleGeneration,
    persistence: state.persistence,
    runtime: state.runtime,
    state,
  };
  const requesterUserId = session.runtime.auth.userId;
  if (!requesterUserId) {
    return;
  }
  const pendingSweeps =
    await session.persistence.listDormantMetadataSweepRequests(
      session.runtime.infra.execSql,
      requesterUserId,
    );
  if (!session.isCurrent()) {
    return;
  }
  const sweeps = await claimDueRestorationSweeps(session, pendingSweeps);
  if (!session.isCurrent() || sweeps.length === 0) {
    return;
  }

  await refreshAllRemoteHydration({
    onFullyHydrated: () => completeRestorationSweeps(session, sweeps),
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
    const lifecycleGeneration = state.lifecycleGeneration;
    try {
      await reconcileRestoredAccess({ ...input, lifecycleGeneration });
    } catch (error) {
      if (state.lifecycleGeneration !== lifecycleGeneration) {
        return;
      }
      const message = `${getContainerContentsStoreLogLabel(state)}: dormant metadata sweep failed`;
      if (state.runtime.util.logError) {
        state.runtime.util.logError(message, error);
      } else {
        state.runtime.util.log(message);
      }
    }
  };
}

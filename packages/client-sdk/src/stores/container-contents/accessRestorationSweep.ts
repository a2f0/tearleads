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

interface RestorationSweepSession {
  isCurrent: () => boolean;
  persistence: ContainerContentsStoreSyncState["persistence"];
  runtime: ContainerContentsStoreSyncState["runtime"];
  state: ContainerContentsStoreSyncState;
}

function createRestorationSweepSession(
  state: ContainerContentsStoreSyncState,
  isCurrent: () => boolean,
): RestorationSweepSession {
  return {
    isCurrent,
    persistence: state.persistence,
    runtime: state.runtime,
    state,
  };
}

function captureRestorationGeneration(
  state: ContainerContentsStoreSyncState,
): () => boolean {
  const lifecycleGeneration = state.lifecycleGeneration;
  const structuralGeneration = state.structuralGeneration;
  return () =>
    state.lifecycleGeneration === lifecycleGeneration &&
    state.structuralGeneration === structuralGeneration;
}

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

function restorationSweepIdentity(sweep: DormantMetadataSweep): string {
  return `${sweep.requesterUserId}\u0000${sweep.organizationId}\u0000${sweep.generation}`;
}

/** A completed crawl can restore verified objects; absence never authorizes data loss. */
async function completeRestorationSweeps(
  session: RestorationSweepSession,
  sweeps: readonly DormantMetadataSweep[],
): Promise<void> {
  for (const sweep of sweeps) {
    if (!session.isCurrent()) return;
    // An unsigned 404 cannot prove that encrypted local edits are disposable.
    // Leave unavailable metadata dormant until verified rediscovery or explicit deletion.
    await session.persistence.completeDormantMetadataSweepRequest(
      session.runtime.infra.execSql,
      sweep,
      session.isCurrent,
    );
  }
}

async function claimDueRestorationSweeps(
  session: RestorationSweepSession,
  sweeps: readonly DormantMetadataSweep[],
  forcedRetrySweepIds?: ReadonlySet<string> | undefined,
): Promise<DormantMetadataSweep[]> {
  const now = Date.now();
  const attemptedAt = new Date(now).toISOString();
  const claimed: DormantMetadataSweep[] = [];
  for (const sweep of sweeps) {
    if (!session.isCurrent()) {
      return claimed;
    }
    if (forcedRetrySweepIds?.has(restorationSweepIdentity(sweep))) {
      // The interrupted generation already claimed and durably counted this
      // attempt. Resume that exact attempt after reset instead of consuming a
      // new one or retiring it at the limit before its completion ran.
      claimed.push(sweep);
      continue;
    }
    if (sweep.attemptCount >= SWEEP_ATTEMPT_LIMIT) {
      await session.persistence.completeDormantMetadataSweepRequest(
        session.runtime.infra.execSql,
        sweep,
        session.isCurrent,
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
      session.isCurrent,
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

async function loadAndClaimRestorationSweeps(
  session: RestorationSweepSession,
  forcedRetrySweepIds?: ReadonlySet<string> | undefined,
): Promise<DormantMetadataSweep[]> {
  const requesterUserId = session.runtime.auth.userId;
  if (!requesterUserId) {
    return [];
  }
  const pendingSweeps =
    await session.persistence.listDormantMetadataSweepRequests(
      session.runtime.infra.execSql,
      requesterUserId,
    );
  if (!session.isCurrent()) {
    return [];
  }
  return claimDueRestorationSweeps(session, pendingSweeps, forcedRetrySweepIds);
}

function recreateRestorationSweepCompletion(
  state: ContainerContentsStoreSyncState,
  interruptedSession: RestorationSweepSession,
  interruptedSweeps: readonly DormantMetadataSweep[],
): () => Promise<void> {
  const session = createRestorationSweepSession(
    state,
    captureRestorationGeneration(state),
  );
  return async () => {
    const sameStorage =
      session.runtime.infra.execSql ===
      interruptedSession.runtime.infra.execSql;
    const forcedRetrySweepIds = sameStorage
      ? new Set(interruptedSweeps.map(restorationSweepIdentity))
      : undefined;
    const sweeps = await loadAndClaimRestorationSweeps(
      session,
      forcedRetrySweepIds,
    );
    if (session.isCurrent() && sweeps.length > 0) {
      await completeRestorationSweeps(session, sweeps);
    }
  };
}

async function reconcileRestoredAccess(input: {
  isCurrent: () => boolean;
  requestHydration: RemoteHydrationRequester;
  state: ContainerContentsStoreSyncState;
}): Promise<void> {
  const { requestHydration, state } = input;
  const session = createRestorationSweepSession(state, input.isCurrent);
  const sweeps = await loadAndClaimRestorationSweeps(session);
  if (!session.isCurrent() || sweeps.length === 0) {
    return;
  }

  await refreshAllRemoteHydration({
    onFullyHydrated: () => completeRestorationSweeps(session, sweeps),
    recreateOnFullyHydratedAfterReset: () =>
      recreateRestorationSweepCompletion(state, session, sweeps),
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
}): (isCurrent?: () => boolean) => Promise<void> {
  const { state } = input;
  return async (isCurrent = captureRestorationGeneration(state)) => {
    try {
      await reconcileRestoredAccess({ ...input, isCurrent });
    } catch (error) {
      if (!isCurrent()) {
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

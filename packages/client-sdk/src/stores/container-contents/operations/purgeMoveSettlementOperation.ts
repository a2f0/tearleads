import { settlePurgeScopeMoves } from "../../../workflows/container-contents/container-state/purge/purgeMoveSettlement";
import type { PurgeOptions } from "../../../workflows/container-contents/container-state/purge/purgeProgress";
import { readContainerContentsSyncLane } from "../../../workflows/container-contents/syncLane";
import { chainRemoteContainerTask } from "../remoteWrites/remoteWriteQueue";
import {
  type ContainerWriteGuard,
  captureContainerWriteGeneration,
} from "../remoteWrites/writeGeneration";
import type { ContainerContentsStoreSyncAgent } from "../syncAgent";
import type { ContainerContentsStoreState } from "../types";

function reportPurgeMoveSettlement(
  state: ContainerContentsStoreState,
  message: string,
  error: Error,
): void {
  const { log, logError } = state.runtime.util;
  try {
    // A host logger that throws or rejects must not change the purge result.
    if (logError)
      void Promise.resolve(logError(message, error)).catch(() => {});
    else log(message);
  } catch {
    // Hosts may throw synchronously or return a rejected promise.
  }
}

/**
 * Delete Forever and Empty Trash often follow a Move to Trash within seconds,
 * before its sync pass reaches the server. Wait for the scope's queued moves
 * before joining the remote write queue, so the wait holds up no other remote
 * task. The purge keeps its own readiness and online gates.
 */
export async function chainPurgeAfterScopeMoves(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  options: PurgeOptions | undefined,
  purge: (isCurrent: ContainerWriteGuard) => Promise<boolean>,
): Promise<boolean> {
  const runtime = state.runtime;
  const chainPurge = () =>
    chainRemoteContainerTask(state, syncAgent, false, purge, containerId);
  if (
    runtime.infra.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !runtime.auth.isAuthenticated ||
    !runtime.state.online ||
    !state.containersById.has(containerId)
  ) {
    return chainPurge();
  }
  const domainScope = runtime.state.domainScope;
  const settlement = await settlePurgeScopeMoves({
    containersById: state.containersById,
    execSql: runtime.infra.execSql,
    lane: {
      read: () => readContainerContentsSyncLane(domainScope),
      request: () => syncAgent.scheduleSync(),
    },
    onMoveSettlement: options?.onMoveSettlement,
    persistence: state.persistence,
    report: (message, error) =>
      reportPurgeMoveSettlement(state, message, error),
    rootContainerId: containerId,
    signal: options?.signal,
    stillCurrent: captureContainerWriteGeneration(state),
  });
  return settlement === "settled" ? chainPurge() : false;
}

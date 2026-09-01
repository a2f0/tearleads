import type { PurgeOptions } from "../../workflows/container-contents/container-state/purgeProgress";
import { purgeContainerTree } from "../../workflows/container-contents/container-state/purgeTree";
import { prepareContainerDocumentRotationSnapshot } from "./documentRotation";
import { getContainerContentsStoreLogLabel } from "./logLabel";
import { updateContainerContentsSnapshot } from "./state";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerState,
} from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";
import type { ContainerWriteGuard } from "./writeGeneration";

type ContainerPurgeResult = NonNullable<
  Awaited<ReturnType<typeof purgeContainerTree>>
>;

/** @internal Reconciles any completed destructive prefix after expiry. */
export async function refreshAfterStalePurge(input: {
  completedCount: number;
  containerStatesAtStart: ReadonlyMap<string, ContainerState>;
  purgedContainerIds: readonly string[];
  state: ContainerContentsStoreState;
  syncAgent: ContainerContentsStoreSyncAgent;
}): Promise<void> {
  if (input.completedCount === 0) return;
  const remoteParentIds = new Set<string | null>();
  for (const purgedContainerId of input.purgedContainerIds) {
    const purgedState = input.containerStatesAtStart.get(purgedContainerId);
    if (purgedState?.record.documentId) {
      remoteParentIds.add(purgedState.container.parentId);
    }
  }

  input.state.localContainersNeedRefresh = true;
  await input.syncAgent.refreshLocalContainers();
  let removedState = false;
  for (const purgedContainerId of input.purgedContainerIds) {
    const deletedState = input.containerStatesAtStart.get(purgedContainerId);
    if (
      deletedState &&
      input.state.containersById.get(purgedContainerId) === deletedState
    ) {
      input.state.containersById.delete(purgedContainerId);
      removedState = true;
    }
  }
  input.state.documentStoresNeedPriming = true;
  if (removedState && input.state.initialized) {
    updateContainerContentsSnapshot(input.state);
  }
  if (remoteParentIds.size > 0) {
    await input.syncAgent.requestRemoteHydration({
      followDiscoveredParentLanes: false,
      parentIds: [...remoteParentIds],
      resetAllLaneWatermarks: true,
    });
  }
}

// Shared core of the two recursive purge operations (purgeContainer and
// emptyTrash): guard readiness and the remote-authority gate, run the
// recursive purge engine, drop the purged containers from the tree, and log
// the outcome. The operations differ only in target validation, whether the
// root container itself survives, and how the result is described/judged.
export async function runContainerPurge(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  options: PurgeOptions | undefined,
  isCurrent: ContainerWriteGuard,
  operation: {
    describeResult: (
      target: ContainerState,
      result: ContainerPurgeResult,
    ) => string;
    didSucceed: (result: ContainerPurgeResult) => boolean;
    keepRootContainer?: boolean | undefined;
    validateTarget: (target: ContainerState) => boolean;
  },
): Promise<boolean> {
  if (state.runtime.infra.dbStatus !== "ready" || !state.snapshot.ready) {
    return false;
  }

  const targetState = state.containersById.get(containerId);
  if (!targetState || !operation.validateTarget(targetState)) {
    return false;
  }

  // Any remote container or document in the subtree needs the server, so require
  // auth + online when the target itself is remote (a local-only subtree can be
  // torn down offline, matching deleteContainer's gate).
  const isRemoteContainer = Boolean(targetState.record.documentId);
  if (
    isRemoteContainer &&
    (!state.runtime.auth.isAuthenticated || !state.runtime.state.online)
  ) {
    return false;
  }
  const containerStatesAtStart = new Map(state.containersById);

  const result = await purgeContainerTree({
    containersById: state.containersById,
    keepRootContainer: operation.keepRootContainer ?? false,
    onProgress: options?.onProgress,
    persistence: state.persistence,
    prepareDocumentRotationSnapshot: (document) =>
      prepareContainerDocumentRotationSnapshot(state.runtime, document),
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    rootContainerId: containerId,
    runtime: state.runtime,
    signal: options?.signal,
    stillCurrent: isCurrent,
  });
  if (!result) {
    return false;
  }
  if (!isCurrent()) {
    await refreshAfterStalePurge({
      completedCount: result.completedCount,
      containerStatesAtStart,
      purgedContainerIds: result.purgedContainerIds,
      state,
      syncAgent,
    });
    return false;
  }

  for (const purgedContainerId of result.purgedContainerIds) {
    state.containersById.delete(purgedContainerId);
  }
  // Only re-render when something actually left the tree; a fully-failed or
  // immediately-cancelled run changed nothing.
  if (result.purgedContainerIds.length > 0) {
    updateContainerContentsSnapshot(state);
  }
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: ${operation.describeResult(targetState, result)}`,
  );
  return operation.didSucceed(result);
}

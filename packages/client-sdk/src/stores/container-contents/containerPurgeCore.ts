import type { PurgeOptions } from "../../workflows/container-contents/container-state/purgeProgress";
import { purgeContainerTree } from "../../workflows/container-contents/container-state/purgeTree";
import { prepareContainerDocumentRotationSnapshot } from "./documentRotation";
import { getContainerContentsStoreLogLabel } from "./logLabel";
import { updateContainerContentsSnapshot } from "./state";
import type { ContainerState } from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";

type ContainerPurgeResult = NonNullable<
  Awaited<ReturnType<typeof purgeContainerTree>>
>;

// Shared core of the two recursive purge operations (purgeContainer and
// emptyTrash): guard readiness and the remote-authority gate, run the
// recursive purge engine, drop the purged containers from the tree, and log
// the outcome. The operations differ only in target validation, whether the
// root container itself survives, and how the result is described/judged.
export async function runContainerPurge(
  state: ContainerContentsStoreState,
  containerId: string,
  options: PurgeOptions | undefined,
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
  });
  if (!result) {
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

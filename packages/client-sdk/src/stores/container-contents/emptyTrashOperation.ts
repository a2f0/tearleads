import type { PurgeOptions } from "../../workflows/container-contents/container-state/purgeProgress";
import { purgeContainerTree } from "../../workflows/container-contents/container-state/purgeTree";
import { updateContainerContentsSnapshot } from "./state";
import type { ContainerContentsStoreState } from "./types";

function getContainerContentsStoreLogLabel(
  state: ContainerContentsStoreState,
): string {
  return state.logLabel ?? "Container contents";
}

// Permanently destroy EVERYTHING under the Trash bin — every trashed folder's
// whole subtree and every document deleted straight into Trash — while leaving
// the Trash system container itself in place. This is "Empty Trash": it reuses
// the recursive purge engine with keepRootContainer so the bin survives, and it
// inherits that engine's semantics — documents also linked outside Trash are
// unlinked (not destroyed), containers are torn down leaf-first, a failed item is
// skipped rather than aborting the sweep, and an optional signal cancels between
// items. The target must be a real system container (the Trash bin); like every
// purge it is online-only when any of its contents are remote.
export async function emptyTrash(
  state: ContainerContentsStoreState,
  trashContainerId: string,
  options?: PurgeOptions,
): Promise<boolean> {
  if (state.runtime.infra.dbStatus !== "ready" || !state.snapshot.ready) {
    return false;
  }

  const trashState = state.containersById.get(trashContainerId);
  if (!trashState || (trashState.container.systemSlot ?? null) === null) {
    return false;
  }
  const isRemoteContainer = Boolean(trashState.record.documentId);
  if (
    isRemoteContainer &&
    (!state.runtime.auth.isAuthenticated || !state.runtime.state.online)
  ) {
    return false;
  }

  const result = await purgeContainerTree({
    containersById: state.containersById,
    keepRootContainer: true,
    onProgress: options?.onProgress,
    persistence: state.persistence,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    rootContainerId: trashContainerId,
    runtime: state.runtime,
    signal: options?.signal,
  });
  if (!result) {
    return false;
  }

  for (const purgedContainerId of result.purgedContainerIds) {
    state.containersById.delete(purgedContainerId);
  }
  if (result.purgedContainerIds.length > 0) {
    updateContainerContentsSnapshot(state);
  }
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: emptied trash (${result.purgedContainerIds.length} container(s) removed, ${result.failedCount} failed)`,
  );
  // A clean empty: nothing failed and it ran to completion.
  return !result.aborted && result.failedCount === 0;
}

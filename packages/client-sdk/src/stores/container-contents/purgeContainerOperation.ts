import { purgeContainerTree } from "../../workflows/container-contents/container-state/purgeTree";
import { updateContainerContentsSnapshot } from "./state";
import type { ContainerContentsStoreState } from "./types";

function getContainerContentsStoreLogLabel(
  state: ContainerContentsStoreState,
): string {
  return state.logLabel ?? "Container contents";
}

// Permanently destroy a container and everything beneath it. Unlike
// deleteContainer (a leaf-only hard delete), this cascades: documents whose last
// link is inside the subtree are purged, multi-folder documents are unlinked
// from the subtree only, and descendant containers are deleted leaf-first. The
// caller (the trash "Delete Forever" action) restricts this to folders under
// trash; here we keep the same structural guards deleteContainer uses — never a
// root and never a system container itself.
export async function purgeContainer(
  state: ContainerContentsStoreState,
  containerId: string,
): Promise<boolean> {
  if (state.runtime.infra.dbStatus !== "ready" || !state.snapshot.ready) {
    return false;
  }

  const existingState = state.containersById.get(containerId);
  if (
    !existingState ||
    existingState.container.parentId === null ||
    (existingState.container.systemSlot ?? null) !== null
  ) {
    return false;
  }

  // Any remote container or document in the subtree needs the server, so require
  // auth + online when the target itself is remote (a local-only subtree can be
  // torn down offline, matching deleteContainer's gate).
  const isRemoteContainer = Boolean(existingState.record.documentId);
  if (
    isRemoteContainer &&
    (!state.runtime.auth.isAuthenticated || !state.runtime.state.online)
  ) {
    return false;
  }

  const result = await purgeContainerTree({
    containersById: state.containersById,
    persistence: state.persistence,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    rootContainerId: containerId,
    runtime: state.runtime,
  });
  if (!result) {
    return false;
  }

  for (const purgedContainerId of result.purgedContainerIds) {
    state.containersById.delete(purgedContainerId);
  }
  updateContainerContentsSnapshot(state);
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: purged container "${existingState.container.name}" (${result.purgedContainerIds.length} container(s))`,
  );
  return result.purgedContainerIds.includes(containerId);
}

import type { PurgeOptions } from "../../workflows/container-contents/container-state/purgeProgress";
import { runContainerPurge } from "./containerPurgeCore";
import type { ContainerContentsStoreState } from "./types";

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
  options?: PurgeOptions,
): Promise<boolean> {
  return runContainerPurge(state, containerId, options, {
    describeResult: (target, result) =>
      `purged container "${target.container.name}" (${result.purgedContainerIds.length} container(s) removed, ${result.failedCount} failed)`,
    didSucceed: (result) => result.purgedContainerIds.includes(containerId),
    validateTarget: (target) =>
      target.container.parentId !== null &&
      (target.container.systemSlot ?? null) === null,
  });
}

import type { PurgeOptions } from "../../workflows/container-contents/container-state/purgeProgress";
import { runContainerPurge } from "./containerPurgeCore";
import type { ContainerContentsStoreState } from "./types";
import type { ContainerWriteGuard } from "./writeGeneration";

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
  isCurrent: ContainerWriteGuard = () => true,
): Promise<boolean> {
  return runContainerPurge(state, trashContainerId, options, isCurrent, {
    describeResult: (_target, result) =>
      `emptied trash (${result.purgedContainerIds.length} container(s) removed, ${result.failedCount} failed)`,
    // A clean empty: nothing failed and it ran to completion.
    didSucceed: (result) => !result.aborted && result.failedCount === 0,
    keepRootContainer: true,
    validateTarget: (target) => (target.container.systemSlot ?? null) !== null,
  });
}

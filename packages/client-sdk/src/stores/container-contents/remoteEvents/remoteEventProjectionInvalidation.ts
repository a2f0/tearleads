import { invalidateContainerProjectionCaches } from "../../../workflows/container-contents/container-state/projectionCache";
import type { ContainerContentsStoreSyncState } from "../syncAgent/syncAgentTypes";

/** Store-facing adapter shared by realtime event handlers. */
export function invalidateCachedProjections(
  state: Pick<ContainerContentsStoreSyncState, "containersById" | "runtime">,
  invalidated: readonly string[],
): void {
  invalidateContainerProjectionCaches(state, invalidated);
}

import { invalidateContainerWriterProjection } from "../../workflows/container-contents/container-state/projectionCache";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

/**
 * Drop every cached writer projection a hint invalidates, before hydration
 * lands, so the next share or move fetches a fresh one instead of submitting
 * against a stale manifest and conflicting. Descendants cite the same ancestor
 * manifests in their paths, so the locally known subtree under each invalidated
 * container is dropped too (an unhydrated subtree has nothing cached). Both
 * layers go: the in-memory copies on each container state, and the api-client's
 * bounded writer projection caches as a whole. Document writer projections cite
 * those paths as well, and the store cannot enumerate a container's linked
 * documents without a query (links live in SQLite), so the api-client caches are
 * cleared wholesale rather than per id; each open document store drops its own
 * in-memory copy on the same hint.
 */
export function invalidateCachedProjections(
  state: Pick<ContainerContentsStoreSyncState, "containersById" | "runtime">,
  invalidated: readonly string[],
): void {
  if (invalidated.length === 0) return;
  const roots = new Set(invalidated);
  const stale = new Set(invalidated);
  for (const [id, containerState] of state.containersById) {
    let parentId = containerState.container.parentId;
    for (
      let depth = 0;
      parentId !== null &&
      !roots.has(parentId) &&
      depth < state.containersById.size;
      depth++
    )
      parentId = state.containersById.get(parentId)?.container.parentId ?? null;
    if (parentId !== null) stale.add(id);
  }
  for (const id of stale) {
    const containerState = state.containersById.get(id);
    if (containerState) {
      invalidateContainerWriterProjection(containerState);
      containerState.metadataWriterProjection = null;
    }
  }
  state.runtime.apiClient.clearWriterProjectionCaches();
}

import type { ContainerContentsStoreState } from "../types";
import { invalidateRemoteContainerWrites } from "./remoteWriteGuards";
import { captureContainerWriteGeneration } from "./writeGeneration";

// null marks an unknown mutation scope; [] delegates invalidation to actual writes.
export function chainContainerWrite(
  state: ContainerContentsStoreState,
  work: (isCurrent: () => boolean) => ContainerContentsStoreState["writeChain"],
  changedIds: readonly string[] | null = null,
  movedId?: string,
): ContainerContentsStoreState["writeChain"] {
  const isCurrent = captureContainerWriteGeneration(state);
  invalidateRemoteContainerWrites(state, changedIds, movedId);
  state.writeChain = state.writeChain
    .catch(() => null)
    .then(() => {
      if (!isCurrent()) return null;
      invalidateRemoteContainerWrites(state, changedIds, movedId);
      return work(isCurrent);
    })
    .then((node) => (isCurrent() ? node : null));
  return state.writeChain;
}

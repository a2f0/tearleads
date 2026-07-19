import { discardPendingContainerWrite } from "../../workflows/container-contents/discardPendingWrite";
import { updateContainerContentsSnapshot } from "./state";
import type { ContainerContentsStoreState } from "./types";

function getContainerContentsStoreLogLabel(
  state: ContainerContentsStoreState,
): string {
  return state.logLabel ?? "Container contents";
}

// Discard a container's queued local writes via the write-queue discard
// workflow, then drop it from the live tree state. Runs on the store's write
// chain (see the store wiring) so a queued rename or move persists before the
// deletion decides — a direct SQLite delete racing such a mutation would be
// silently re-created by it — and so the snapshot stops rendering the
// container the moment its rows are gone.
export async function discardContainer(
  state: ContainerContentsStoreState,
  containerId: string,
): Promise<boolean> {
  if (state.runtime.infra.dbStatus !== "ready") {
    return false;
  }

  const discarded = await discardPendingContainerWrite(
    state.runtime.infra.execSql,
    containerId,
  );
  if (!discarded) {
    return false;
  }

  const existingState = state.containersById.get(containerId);
  if (existingState) {
    state.containersById.delete(containerId);
    updateContainerContentsSnapshot(state);
    state.runtime.util.log(
      `${getContainerContentsStoreLogLabel(state)}: discarded container "${existingState.container.name}" from the live tree`,
    );
  }
  return true;
}

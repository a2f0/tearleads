import {
  installContainerMetadataRecord,
  setContainerIconMetadataStateFromRuntime,
} from "../../workflows/container-contents/metadata";
import {
  createDetachedContainerMetadataState,
  installDetachedContainerMetadataState,
} from "../../workflows/container-contents/metadataStateIsolation";
import { getContainerContentsStoreLogLabel } from "./logLabel";
import { removeMissingContainerState } from "./missingContainerState";
import { updateContainerContentsSnapshot } from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";
import { toContainerNode } from "./utils";
import type { ContainerWriteGuard } from "./writeGeneration";

// Set the icon shown for a container. Mirrors renameContainer's write path: it
// writes the icon into the container metadata document (CRDT), enqueues the
// incremental update, persists, and schedules a sync. A null icon clears the
// custom icon back to the default folder. No-ops when the icon is unchanged.
export async function setContainerIcon(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  icon: string | null,
  isCurrent: ContainerWriteGuard = () => true,
) {
  if (state.runtime.infra.dbStatus !== "ready" || !state.snapshot.ready) {
    return null;
  }

  const existingState = state.containersById.get(containerId);
  if (!existingState) {
    return null;
  }

  const normalizedIcon = icon?.trim() || null;
  if ((existingState.container.icon ?? null) === normalizedIcon) {
    return toContainerNode(existingState);
  }

  const detachedState =
    await createDetachedContainerMetadataState(existingState);
  if (!isCurrent()) return null;
  const updated = await setContainerIconMetadataStateFromRuntime({
    icon: normalizedIcon,
    metadataState: detachedState,
    persistence: state.persistence,
    runtime: state.runtime,
    stillCurrent: isCurrent,
  });
  if (!isCurrent()) return null;
  if (!updated) {
    removeMissingContainerState(state, existingState);
    return null;
  }

  detachedState.container = updated.container;
  installContainerMetadataRecord(detachedState, updated.record);
  installDetachedContainerMetadataState(existingState, detachedState);
  updateContainerContentsSnapshot(state);
  syncAgent.scheduleSync();
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: set container ${containerId} icon to "${normalizedIcon ?? "folder"}"`,
  );
  return toContainerNode(existingState);
}

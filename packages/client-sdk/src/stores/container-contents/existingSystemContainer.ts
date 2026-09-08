import { persistContainerState } from "./containerStatePersistence";
import { getContainerContentsStoreLogLabel } from "./logLabel";
import { invalidateRemoteContainerWrites } from "./remoteWriteGuards";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerState,
} from "./syncAgent";
import { applySystemContainerIcon } from "./systemContainerIcon";
import { findRootContainerState } from "./systemContainerLookup";
import { promoteExistingLocalSystemContainerSync } from "./systemContainerPromotion";
import type {
  ContainerContentsStoreState,
  EnsureSystemContainerOptions,
} from "./types";
import { toContainerNode } from "./utils";
import type { ContainerWriteGuard } from "./writeGeneration";

export async function updateExistingSystemContainer(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  existing: ContainerState,
  options: EnsureSystemContainerOptions,
  isCurrent: ContainerWriteGuard,
) {
  if ("icon" in options) {
    const iconApplied = await applySystemContainerIcon({
      containerState: existing,
      icon: options.icon,
      persistIcon: async (containerState, icon, update) => {
        if (options.deferRemoteBootstrap) {
          invalidateRemoteContainerWrites(state, [containerState.container.id]);
        }
        const result = await persistContainerState(state, containerState, {
          patch: { icon },
          updateView: false,
          localMetadataPatch: { icon },
          localUpdate: update,
          isCurrent,
        });
        return result.status;
      },
      state,
      syncAgent,
      isCurrent,
    });
    if (!iconApplied || !isCurrent()) {
      return null;
    }
  }
  const promoted = await promoteExistingLocalSystemContainerSync({
    containerState: existing,
    logLabel: getContainerContentsStoreLogLabel(state),
    options,
    persistPromotion: async (containerState, promotion) => {
      if (options.deferRemoteBootstrap) {
        invalidateRemoteContainerWrites(state, [containerState.container.id]);
      }
      const result = await persistContainerState(state, containerState, {
        saveOptions: promotion.queueCreateIntent
          ? { createIntent: { parentContainerId: promotion.parentContainerId } }
          : undefined,
        localUpdate: promotion.metadataUpdate || undefined,
        isCurrent,
      });
      return result.status === "persisted";
    },
    rootState: findRootContainerState(state),
    state,
    syncAgent,
    isCurrent,
  });
  return promoted && isCurrent() ? toContainerNode(existing) : null;
}

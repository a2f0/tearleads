import { persistContainerState } from "../containerState/containerStatePersistence";
import { getContainerContentsStoreLogLabel } from "../logLabel";
import { invalidateRemoteContainerWrites } from "../remoteWrites/remoteWriteGuards";
import type { ContainerWriteGuard } from "../remoteWrites/writeGeneration";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerState,
} from "../syncAgent";
import type {
  ContainerContentsStoreState,
  EnsureSystemContainerOptions,
} from "../types";
import { toContainerNode } from "../utils";
import { applySystemContainerIcon } from "./systemContainerIcon";
import { findRootContainerState } from "./systemContainerLookup";
import { promoteExistingLocalSystemContainerSync } from "./systemContainerPromotion";

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
        localUpdate: promotion.metadataUpdate,
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

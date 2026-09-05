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
        return (
          await persistContainerState(
            state,
            containerState,
            { icon },
            false,
            undefined,
            { localMetadataPatch: { icon }, localUpdate: update },
            { isCurrent },
          )
        ).status;
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
      return (
        (
          await persistContainerState(
            state,
            containerState,
            {},
            true,
            promotion.queueCreateIntent
              ? {
                  createIntent: {
                    parentContainerId: promotion.parentContainerId,
                  },
                }
              : undefined,
            promotion.metadataUpdate
              ? { localUpdate: promotion.metadataUpdate }
              : undefined,
            { isCurrent },
          )
        ).status === "persisted"
      );
    },
    rootState: findRootContainerState(state),
    state,
    syncAgent,
    isCurrent,
  });
  return promoted && isCurrent() ? toContainerNode(existing) : null;
}

import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  createChildContainerState,
  deriveSystemContainerId,
} from "../../../workflows/container-contents/container-state/create/createChild";
import { withPlannedMetadataDocumentId } from "../../../workflows/container-contents/container-state/create/createIntentSeed";
import { getContainerContentsStoreLogLabel } from "../logLabel";
import type { ContainerWriteGuard } from "../remoteWrites/writeGeneration";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerState,
} from "../syncAgent";
import type {
  ContainerContentsStoreState,
  EnsureSystemContainerOptions,
} from "../types";
import { finalizeCreatedSystemContainer } from "./systemContainerPostCreate";

/**
 * Creates a missing system slot under its root. An eager remote create keeps
 * its planned metadata document id registered until the created state is
 * installed, so a peer's metadata hint that arrives before the response still
 * queues the read the committed seed would otherwise make unnecessary.
 */
export async function createSystemContainer(input: {
  createRemote: boolean;
  isCurrent: ContainerWriteGuard;
  options: EnsureSystemContainerOptions;
  rootState: ContainerState;
  state: ContainerContentsStoreState;
  syncAgent: ContainerContentsStoreSyncAgent;
  systemSlot: ContainerSystemSlot;
  trimmedName: string;
}) {
  const { createRemote, isCurrent, rootState, state, syncAgent, systemSlot } =
    input;
  const create = async () => {
    const created = await createChildContainerState({
      systemSlot,
      createRemote,
      icon: input.options.icon,
      locallyAcceptedMetadataUpdateIds: state.locallyAcceptedMetadataUpdateIds,
      name: input.trimmedName,
      parentState: rootState,
      persistence: state.persistence,
      queueRemoteSync: !input.options.deferRemoteSync,
      resolveProjectionUserKey: state.resolveProjectionUserKey,
      runtime: state.runtime,
      stillCurrent: isCurrent,
    });
    if (!isCurrent()) {
      if (createRemote) {
        state.containerParentIdsNeedingHydration.add(rootState.container.id);
        syncAgent.scheduleRemoteHydration();
      }
      return null;
    }
    if (!created) return null;
    return finalizeCreatedSystemContainer({
      created,
      logLabel: getContainerContentsStoreLogLabel(state),
      state,
      syncAgent,
      systemSlot,
      isCurrent,
    });
  };
  if (!createRemote) return create();
  const containerId = await deriveSystemContainerId({
    parentContainerId: rootState.container.id,
    systemSlot,
  });
  return withPlannedMetadataDocumentId(
    state.plannedMetadataDocumentIds,
    containerId,
    create,
  );
}

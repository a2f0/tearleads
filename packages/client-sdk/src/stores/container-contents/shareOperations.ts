import {
  shareContainerState,
  shareContainerStateWithGroup,
} from "../../workflows/container-contents/container-state/share";
import type { SharedContainerStateResult } from "../../workflows/container-contents/container-state/types";
import { installContainerMetadataRecord } from "../../workflows/container-contents/metadata";
import { getContainerContentsStoreLogLabel } from "./logLabel";
import { removeMissingContainerState } from "./missingContainerState";
import { updateContainerContentsSnapshot } from "./state";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerState,
} from "./syncAgent";
import type {
  ContainerContentsShareAccessLevel,
  ContainerContentsStoreState,
} from "./types";
import { toContainerNode } from "./utils";
import type { ContainerWriteGuard } from "./writeGeneration";

export async function shareContainerUsing(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  share: (
    containerState: ContainerState,
  ) => Promise<SharedContainerStateResult | null>,
  logMessage: string,
  isCurrent: ContainerWriteGuard = () => true,
) {
  if (
    state.runtime.infra.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !state.runtime.auth.isAuthenticated ||
    !state.runtime.state.online ||
    !isCurrent()
  ) {
    return null;
  }

  const existingState = state.containersById.get(containerId);
  const expectedAccessStateHash = existingState?.record.accessStateHash;
  if (
    !existingState?.record.documentId ||
    typeof expectedAccessStateHash !== "string" ||
    expectedAccessStateHash.length === 0
  ) {
    return null;
  }

  const shared = await share(existingState);
  if (!shared || !isCurrent()) {
    if (!isCurrent()) {
      state.localContainersNeedRefresh = true;
      state.containerParentIdsNeedingHydration.add(
        existingState.container.parentId,
      );
      void syncAgent.refreshLocalContainers();
      syncAgent.scheduleRemoteHydration();
    }
    return null;
  }
  if (shared.status === "missing") {
    removeMissingContainerState(state, existingState);
    return null;
  }

  existingState.container = shared.container;
  installContainerMetadataRecord(existingState, shared.record);
  updateContainerContentsSnapshot(state);
  if (shared.status === "identity-superseded") return null;

  await syncAgent.primeDocumentsForSharedSubtree(containerId, isCurrent);
  if (!isCurrent()) return null;
  syncAgent.scheduleSync();
  state.runtime.util.log(
    `${getContainerContentsStoreLogLabel(state)}: ${logMessage}`,
  );
  return toContainerNode(existingState);
}

export async function shareContainerWithUser(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  userId: string,
  isCurrent: ContainerWriteGuard = () => true,
) {
  return shareContainerUsing(
    state,
    syncAgent,
    containerId,
    (containerState) =>
      shareContainerState({
        accessLevel: "write",
        containerState,
        persistence: state.persistence,
        recipientUserId: userId,
        resolveProjectionUserKey: state.resolveProjectionUserKey,
        runtime: state.runtime,
        stillCurrent: isCurrent,
      }),
    `shared container ${containerId} with ${userId}`,
    isCurrent,
  );
}

export async function shareContainerWithGroup(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  groupId: string,
  accessLevel: ContainerContentsShareAccessLevel,
  options: {
    expectedGroupName?: string | undefined;
    knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
    requireExistingGrant?: boolean | undefined;
  } = {},
  isCurrent: ContainerWriteGuard = () => true,
) {
  return shareContainerUsing(
    state,
    syncAgent,
    containerId,
    (containerState) =>
      shareContainerStateWithGroup({
        accessLevel,
        containerState,
        expectedGroupName: options.expectedGroupName,
        knownContainerKeks: options.knownContainerKeks,
        persistence: state.persistence,
        recipientGroupId: groupId,
        requireExistingGrant: options.requireExistingGrant,
        resolveProjectionUserKey: state.resolveProjectionUserKey,
        runtime: state.runtime,
        stillCurrent: isCurrent,
      }),
    `shared container ${containerId} with group ${groupId}`,
    isCurrent,
  );
}

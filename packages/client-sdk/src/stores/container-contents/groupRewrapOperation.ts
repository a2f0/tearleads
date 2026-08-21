import type { ReferencedPrincipalHead } from "@symcrypt/crypto";
import { containerStateHasCurrentGroupGrant } from "../../workflows/container-contents/container-state/groupGrantVerification";
import { prepareContainerStateGroupRewrap } from "../../workflows/container-contents/container-state/share";
import type {
  ContainerContentsShareAccessLevel,
  ContainerContentsStoreState,
} from "./types";

export async function prepareContainerGroupRewrap(
  state: ContainerContentsStoreState,
  containerId: string,
  groupId: string,
  accessLevel: ContainerContentsShareAccessLevel,
  options?: { requireExistingGrant?: boolean } | undefined,
) {
  if (
    state.runtime.infra.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !state.runtime.auth.isAuthenticated ||
    !state.runtime.state.online
  ) {
    return null;
  }
  const containerState = state.containersById.get(containerId);
  if (!containerState) {
    return null;
  }

  return prepareContainerStateGroupRewrap({
    accessLevel,
    containerState,
    groupId,
    requireExistingGrant: options?.requireExistingGrant,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });
}

export async function verifyContainerGroupRewrapCurrent(
  state: ContainerContentsStoreState,
  containerId: string,
  groupId: string,
  accessLevel: ContainerContentsShareAccessLevel,
  expectedGroupHead: ReferencedPrincipalHead,
  expectedContainerId: string,
  expectedOrganizationId: string,
): Promise<boolean> {
  if (
    state.runtime.infra.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !state.runtime.auth.isAuthenticated ||
    !state.runtime.state.online
  ) {
    return false;
  }
  if (containerId !== expectedContainerId) {
    return false;
  }
  const containerState = state.containersById.get(expectedContainerId);
  if (!containerState) {
    return false;
  }

  return containerStateHasCurrentGroupGrant({
    accessLevel,
    containerState,
    expectedContainerId,
    expectedGroupHead,
    expectedOrganizationId,
    groupId,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });
}

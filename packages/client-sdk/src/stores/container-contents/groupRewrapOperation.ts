import type { ReferencedPrincipalHead } from "@symcrypt/crypto";
import { containerStateHasCurrentGroupGrant } from "../../workflows/container-contents/container-state/groupGrantVerification";
import { prepareContainerStateGroupRewrap } from "../../workflows/container-contents/container-state/share";
import type {
  ContainerContentsShareAccessLevel,
  ContainerContentsStoreState,
} from "./types";
import type { ContainerWriteGuard } from "./writeGeneration";

export async function prepareContainerGroupRewrap(
  state: ContainerContentsStoreState,
  containerId: string,
  groupId: string,
  accessLevel: ContainerContentsShareAccessLevel,
  options?: { requireExistingGrant?: boolean } | undefined,
  isCurrent: ContainerWriteGuard = () => true,
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

  const preparation = await prepareContainerStateGroupRewrap({
    accessLevel,
    containerState,
    groupId,
    requireExistingGrant: options?.requireExistingGrant,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });
  return isCurrent() ? preparation : null;
}

export async function verifyContainerGroupRewrapCurrent(
  state: ContainerContentsStoreState,
  containerId: string,
  groupId: string,
  accessLevel: ContainerContentsShareAccessLevel,
  expectedGroupHead: ReferencedPrincipalHead,
  expectedContainerId: string,
  expectedOrganizationId: string,
  isCurrent: ContainerWriteGuard = () => true,
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

  const current = await containerStateHasCurrentGroupGrant({
    accessLevel,
    containerState,
    expectedContainerId,
    expectedGroupHead,
    expectedOrganizationId,
    groupId,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });
  return isCurrent() && current;
}

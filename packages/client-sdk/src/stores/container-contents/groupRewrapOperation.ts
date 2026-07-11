import { prepareContainerStateGroupRewrap } from "../../workflows/container-contents/container-state/share";
import type { ContainerContentsStoreState } from "./types";

export async function prepareContainerGroupRewrap(
  state: ContainerContentsStoreState,
  containerId: string,
): Promise<ReadonlyMap<string, Uint8Array> | null> {
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
    containerState,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });
}

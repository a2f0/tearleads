import type { ContainerWriterProjectionResponse } from "@symcrypt/validators/response";
import type { ContainerState } from "../remoteHydration";
import type { ContainerWorkflowRuntime } from "./types";

function cachedProjectionMatchesContainerState(input: {
  containerState: ContainerState;
  projection: ContainerWriterProjectionResponse;
}): boolean {
  const { containerState, projection } = input;
  if (projection.containerId !== containerState.container.id) {
    return false;
  }

  const targetManifest = projection.path.at(-1);
  const targetKek = projection.containerKeks.at(-1);
  if (
    !targetManifest ||
    !targetKek ||
    targetKek.containerId !== projection.containerId ||
    targetKek.accessManifestHash !== targetManifest.manifestHash
  ) {
    return false;
  }

  const expectedAccessStateHash = containerState.record.accessStateHash;
  return (
    typeof expectedAccessStateHash !== "string" ||
    expectedAccessStateHash.length === 0 ||
    targetManifest.manifestHash === expectedAccessStateHash
  );
}

export function getCachedContainerWriterProjection(
  containerState: ContainerState,
): ContainerWriterProjectionResponse | null {
  const projection = containerState.containerWriterProjection ?? null;
  return projection &&
    cachedProjectionMatchesContainerState({ containerState, projection })
    ? projection
    : null;
}

export async function loadContainerWriterProjectionForState(input: {
  containerState: ContainerState;
  runtime: ContainerWorkflowRuntime;
}): Promise<ContainerWriterProjectionResponse | null> {
  const cachedProjection = getCachedContainerWriterProjection(
    input.containerState,
  );
  if (cachedProjection) {
    return cachedProjection;
  }

  const projection = await input.runtime.apiClient.getContainerWriterProjection(
    input.containerState.container.id,
  );
  input.containerState.containerWriterProjection = projection;
  return projection;
}

import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { projectionGeneration } from "../projectionGeneration";
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

// A hint can invalidate a container while its load is in flight; each retry
// re-reads the generation, so this only bounds a pathological hint storm.
const MAX_PROJECTION_LOAD_ATTEMPTS = 3;

/**
 * Drop both cached writer projections (the container's and its metadata
 * document's) and advance their shared generation, so an operation that
 * started before this invalidation (and may carry a pre-hint manifest) cannot
 * install its result.
 */
export function invalidateContainerProjections(
  containerState: ContainerState,
): void {
  containerState.containerWriterProjection = null;
  containerState.metadataWriterProjection = null;
  containerState.writerProjectionGeneration =
    projectionGeneration(containerState) + 1;
}

/**
 * Install a container projection an operation fetched or was handed back,
 * unless a hint invalidated the container while that operation ran: its
 * answer may predate the hint, so the slot is left as the hint left it and the
 * next operation fetches fresh.
 */
export function installContainerWriterProjection(
  containerState: ContainerState,
  projection: ContainerWriterProjectionResponse | null,
  capturedGeneration: number,
): void {
  if (projectionGeneration(containerState) !== capturedGeneration) return;
  containerState.containerWriterProjection = projection;
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

  let projection: ContainerWriterProjectionResponse | null = null;
  for (let attempt = 0; attempt < MAX_PROJECTION_LOAD_ATTEMPTS; attempt++) {
    const generation = projectionGeneration(input.containerState);
    projection = await input.runtime.apiClient.getContainerWriterProjection(
      input.containerState.container.id,
    );
    if (projectionGeneration(input.containerState) === generation) {
      installContainerWriterProjection(
        input.containerState,
        projection,
        generation,
      );
      return projection;
    }
    // Invalidated while in flight (the api-client entry went with it): this
    // answer may predate the hint, so fetch again instead of caching it.
  }
  return projection;
}

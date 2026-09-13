import type { ContainerMetadataState } from "./metadataTypes";

/**
 * The shared writer-projection generation of a container state (container and
 * metadata-document projections move together). A leaf so hydration, metadata
 * settlement, and the projection cache can all read it without importing one
 * another.
 */
export function projectionGeneration(
  state: Pick<ContainerMetadataState, "writerProjectionGeneration">,
): number {
  return state.writerProjectionGeneration ?? 0;
}

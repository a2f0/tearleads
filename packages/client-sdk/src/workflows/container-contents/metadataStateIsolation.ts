import { exportFullHistorySnapshot, importSnapshot } from "@symcrypt/loro";
import { createContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import type { ContainerMetadataState } from "./metadataTypes";

/**
 * Gives an asynchronous sync pass its own mutable metadata projection. Durable
 * settlement can then repair or replace the candidate without changing the
 * live store until the caller has rechecked its lifecycle generation.
 */
export async function createDetachedContainerMetadataState(
  metadataState: ContainerMetadataState,
): Promise<ContainerMetadataState> {
  const doc = await createContainerMetadataDocument(metadataState.container.id);
  importSnapshot(doc, exportFullHistorySnapshot(metadataState.doc));
  return {
    ...metadataState,
    container: { ...metadataState.container },
    doc,
    record: { ...metadataState.record },
  };
}

export function installDetachedContainerMetadataState(
  target: ContainerMetadataState,
  candidate: ContainerMetadataState,
): void {
  target.container = candidate.container;
  target.doc = candidate.doc;
  target.metadataWriterProjection = candidate.metadataWriterProjection;
  target.pullContinuation = candidate.pullContinuation;
  target.record = candidate.record;
  target.rekeyOnlyPassCount = candidate.rekeyOnlyPassCount;
}

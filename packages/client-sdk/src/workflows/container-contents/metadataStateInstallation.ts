import type { ContainerDocumentRecord } from "./containerPersistence";
import type { ContainerMetadataState } from "./metadataTypes";

export function installContainerMetadataRecord(
  metadataState: ContainerMetadataState,
  record: ContainerDocumentRecord,
): void {
  metadataState.record = record;
  metadataState.pullContinuation = record.pullContinuation ?? null;
}

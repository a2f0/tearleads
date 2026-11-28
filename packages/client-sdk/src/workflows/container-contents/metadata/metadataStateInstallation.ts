import type { ContainerDocumentRecord } from "../containerPersistence";
import { resetMetadataPeerRestorePark } from "./metadataPeerRebase";
import type { ContainerMetadataState } from "./metadataTypes";

export function installContainerMetadataRecord(
  metadataState: ContainerMetadataState,
  record: ContainerDocumentRecord,
): void {
  if (metadataState.record.documentId !== record.documentId) {
    resetMetadataPeerRestorePark(metadataState);
  }
  metadataState.record = record;
  metadataState.pullContinuation = record.pullContinuation ?? null;
}

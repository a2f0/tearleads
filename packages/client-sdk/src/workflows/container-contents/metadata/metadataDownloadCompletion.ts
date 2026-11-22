import { emptyVersionVector } from "@tearleads/loro";
import { deriveMetadataEndVersion } from "../../../data/persistence/container-contents/containerMetadataRows";
import type { ContainerRecord } from "../../../data/persistence/container-contents/containerPersistence";
import type { DomainScope } from "../../../data/shared/domainScope";
import { recordDomainCompletedDownload } from "../../../data/sync/downloadHistory";
import type { ContainerMetadataState } from "./metadataTypes";

type ContainerMetadataRecord = ContainerMetadataState["record"];

/**
 * Whether a folder's metadata record is in the download queue as
 * `listPendingDownloads` reads it: a synced folder whose metadata was never
 * pulled, or whose pull still has pages left.
 */
function isQueuedForDownload(record: ContainerMetadataRecord): boolean {
  if (record.documentId === null) return false;
  if (
    (record.pullContinuation ?? null) !== null ||
    record.pullContinuationRecoveryRequired === true
  )
    return true;
  const frontier = deriveMetadataEndVersion(record.metadataUpdates);
  return frontier === "" || frontier === emptyVersionVector();
}

/**
 * Record a finished folder download in the scope's history: a metadata pull
 * that took the folder out of the queue it was in when the request was made.
 */
export function noteContainerMetadataDownloadDrained(input: {
  readonly container: ContainerRecord;
  readonly domainScope: DomainScope;
  readonly requestRecord: ContainerMetadataRecord;
  readonly requestedPage: boolean;
  readonly storedRecord: ContainerMetadataRecord;
}): void {
  const { container, storedRecord } = input;
  if (!(input.requestedPage || isQueuedForDownload(input.requestRecord)))
    return;
  if (storedRecord.documentId === null || isQueuedForDownload(storedRecord))
    return;
  recordDomainCompletedDownload(input.domainScope, {
    documentId: storedRecord.documentId,
    localId: container.id,
    objectKind: "container",
    title: container.name,
  });
}

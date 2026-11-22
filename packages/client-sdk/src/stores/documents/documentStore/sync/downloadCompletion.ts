import type { DocumentRecord } from "../../../../workflows/documents";
import { recordDomainCompletedDownload } from "../../../../workflows/sync/coordination";
import { documentTitleFromRecord } from "../persistence";
import type { DocumentStoreState } from "../state";

/**
 * Whether a stored record is in the download queue as `listPendingDownloads`
 * reads it: a synced document whose content was never pulled, or whose stored
 * continuation is not null. A continuation that failed to parse is still a
 * stored one, so recovery counts too.
 */
function isQueuedForDownload(record: DocumentRecord): boolean {
  return (
    record.documentId !== null &&
    (record.snapshotEndVersion === "" ||
      (record.pullContinuation ?? null) !== null ||
      record.pullContinuationRecoveryRequired === true)
  );
}

/**
 * Record a finished download in the scope's history: a pull that drained the
 * server's updates and took this document out of the queue it was in when the
 * request was made. A pull of a document already stored is a sync, not a
 * download. The stored record's container is the projection's, which every
 * persist reads back.
 */
export function noteDocumentDownloadDrained(input: {
  readonly requestRecord: DocumentRecord;
  readonly requestedPage: boolean;
  readonly state: DocumentStoreState;
  readonly storedRecord: DocumentRecord;
}): void {
  const { requestRecord, state, storedRecord } = input;
  if (!(input.requestedPage || isQueuedForDownload(requestRecord))) return;
  if (storedRecord.documentId === null || isQueuedForDownload(storedRecord))
    return;
  recordDomainCompletedDownload(state.runtime.state.domainScope, {
    containerId: storedRecord.containerId,
    documentId: storedRecord.documentId,
    localId: state.localId,
    objectKind: "document",
    title: documentTitleFromRecord(
      storedRecord,
      state.runtime.infra.documentProjectors,
    ),
  });
}

/**
 * Record a file's first download: a slot of this document that held no local
 * copy now holds one. Replacing or recovering a held copy is not a download.
 */
export function noteAttachmentDownloaded(input: {
  readonly attachment: {
    readonly blobId: string | null;
    readonly slotId: string;
    readonly storageKey: string;
  };
  readonly fileName: string;
  readonly state: DocumentStoreState;
}): void {
  const { attachment, state } = input;
  const record = state.record;
  if (!record || record.documentId === null) return;
  recordDomainCompletedDownload(state.runtime.state.domainScope, {
    blobId: attachment.blobId,
    containerId: record.containerId,
    documentId: record.documentId,
    fileName: input.fileName,
    localId: state.localId,
    objectKind: "attachment",
    slotId: attachment.slotId,
    storageKey: attachment.storageKey,
    title: documentTitleFromRecord(
      record,
      state.runtime.infra.documentProjectors,
    ),
  });
}

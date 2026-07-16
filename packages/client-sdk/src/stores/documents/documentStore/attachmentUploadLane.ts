import type { DomainScope } from "../../../data/domainScope";
import type { MultipartUploadProgressListener } from "../../../workflows/blobs";
import type { PendingAttachmentRecord } from "../../../workflows/documents";
import {
  beginDomainSyncUploadLane,
  type UploadSyncLane,
} from "../../../workflows/sync";

export interface AttachmentUploadLaneReporter {
  complete: () => void;
  fail: (error: unknown) => void;
  failIfStarted: (error: unknown) => void;
  onMultipartProgress: MultipartUploadProgressListener;
}

function getAttachmentUploadLaneLabel(name: string | null | undefined): string {
  return name ? `Upload ${name}` : "Attachment upload";
}

function getAttachmentUploadFailureTarget(
  pendingAttachment: PendingAttachmentRecord,
): string {
  return pendingAttachment.name
    ? `${pendingAttachment.name} (slot ${pendingAttachment.slotId})`
    : `slot ${pendingAttachment.slotId}`;
}

export function createAttachmentUploadFailedError(
  pendingAttachment: PendingAttachmentRecord,
  cause: unknown,
): Error {
  const error = new Error(
    `Attachment upload failed for ${getAttachmentUploadFailureTarget(pendingAttachment)}.`,
  );
  if (cause !== undefined) Reflect.set(error, "cause", cause);

  return error;
}

/**
 * Surfaces attachment uploads as observational lanes. The persisted blob id is
 * the lane identity: slot ids repeat across documents, while a retry must keep
 * updating the same row. Lane creation stays lazy until progress, failure, or
 * completion so a billing block before any upload work does not add noise.
 */
export function createAttachmentUploadLaneReporter(input: {
  blobId: string;
  domainScope: DomainScope;
  pendingAttachment: PendingAttachmentRecord;
}): AttachmentUploadLaneReporter {
  const { blobId, domainScope, pendingAttachment } = input;
  const laneRef: { current: UploadSyncLane | null } = { current: null };

  const ensureLane = (): UploadSyncLane => {
    laneRef.current ??= beginDomainSyncUploadLane(
      domainScope,
      `blob-upload:${blobId}`,
      {
        blobStorageKey: pendingAttachment.storageKey,
        label: getAttachmentUploadLaneLabel(pendingAttachment.name),
      },
    );
    return laneRef.current;
  };

  return {
    complete() {
      // Completion must create/re-begin the lane too: a resumed stage can
      // already be complete before it emits any per-part callbacks.
      ensureLane().complete();
    },
    fail(error: unknown) {
      ensureLane().fail(error);
    },
    failIfStarted(error: unknown) {
      laneRef.current?.fail(error);
    },
    onMultipartProgress(progress) {
      ensureLane().reportProgress(progress);
    },
  };
}

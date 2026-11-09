import {
  DOCUMENTS_APP_KIND,
  type PendingAttachmentRecord,
  recordDocumentSyncFailure,
  runSerializedSqlMutation,
} from "../../../../workflows/documents";
import {
  type AttachmentUploadLaneReporter,
  createAttachmentUploadFailedError,
} from "../attachmentUpload/attachmentUploadLane";
import type { DocumentStoreState } from "../state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";

export function reportAttachmentUploadFailure(input: {
  attachmentGeneration: DocumentStoreSyncGeneration;
  error: unknown;
  pendingAttachment: PendingAttachmentRecord;
  state: DocumentStoreState;
  uploadLane: AttachmentUploadLaneReporter;
}): void {
  const error = createAttachmentUploadFailedError(
    input.pendingAttachment,
    input.error,
  );
  input.uploadLane.fail(error);
  input.state.runtime.util.log(`Documents: ${error.message}`);
  // Surface the stuck upload in the write queue; a later successful sync pass
  // for the document clears the record. Validated inside the serialized
  // mutation: a teardown (reset/discard) racing this pass just cleared the
  // failure row, and re-recording it would resurrect a phantom queue entry
  // for work that no longer exists.
  void runSerializedSqlMutation(
    input.state.runtime.infra.execSql,
    async (lockedExecSql) => {
      if (
        !isDocumentStoreSyncGenerationCurrent(
          input.state,
          input.attachmentGeneration,
        )
      ) {
        return;
      }
      await recordDocumentSyncFailure(
        lockedExecSql,
        { appKind: DOCUMENTS_APP_KIND, localId: input.state.localId },
        {
          attemptedAt: new Date().toISOString(),
          message: error.message,
          status: null,
        },
      );
    },
  ).catch(() => undefined);
}

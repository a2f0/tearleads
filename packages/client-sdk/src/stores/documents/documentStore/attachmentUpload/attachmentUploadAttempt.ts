import { reportAndRethrowKeyingVerificationError } from "../../../../data/shared/securityIncidents";
import type {
  BlobAttachmentService,
  UploadDocumentAttachmentResult,
} from "../../../../workflows/blobs";
import { uploadInspectedDocumentAttachment } from "../../../../workflows/blobs/blobAttachmentService";
import type { PreparedUploadDocumentAttachmentRequest as AttachmentUploadInput } from "../../../../workflows/blobs/upload";
import type { DocumentVersionBindStatus } from "../../../../workflows/blobs/upload/bindAtDocumentVersion";
import type { DocumentStoreState } from "../state";

function withResumedMultipartStage(
  uploadInput: AttachmentUploadInput,
  stage: { readonly partSize: number; readonly stageId: string } | undefined,
): AttachmentUploadInput {
  return stage
    ? {
        ...uploadInput,
        multipart: {
          ...(uploadInput.multipart ?? {}),
          partSize: stage.partSize,
          resumeStageId: stage.stageId,
        },
      }
    : uploadInput;
}

/** How one upload attempt ended; the first matching status wins. */
export type AttachmentUploadAttempt =
  | {
      readonly status: "uploaded";
      readonly uploaded: UploadDocumentAttachmentResult;
    }
  /** A billing pause stopped it; no failure is reported. */
  | { readonly status: "syncBlocked" }
  /**
   * The upload call's binds ended because the document advanced: its last
   * bind was refused for a newer document, or its check after a refusal
   * abandoned the bind (the slot no longer asks for the bytes, or the pull
   * did not complete). A bind that then failed otherwise, or a throw, is
   * `failed`, so its error is reported.
   */
  | { readonly status: "documentChanged" }
  | { readonly status: "failed"; readonly error: unknown };

export async function uploadAttachmentWithWriterProjectionRetry(input: {
  baseUploadInput: AttachmentUploadInput;
  /** The service whose executor the base input was built beside. */
  blobAttachments: BlobAttachmentService;
  state: DocumentStoreState;
  writerProjection: DocumentStoreState["writerProjection"];
}): Promise<AttachmentUploadAttempt> {
  let remoteSyncBlocked = false;
  /** How the latest upload call's binds ended; null until one reaches a bind. */
  let bindEnd: DocumentVersionBindStatus | null = null;
  let checkedOrganizationId: string | undefined;
  let resolvedMultipartStage:
    | { readonly partSize: number; readonly stageId: string }
    | undefined;
  const onStageResolved = async (stage: {
    readonly partSize: number;
    readonly stageId: string;
  }) => {
    resolvedMultipartStage = stage;
    await input.baseUploadInput.onStageResolved?.(stage);
  };
  const baseUploadInput = {
    ...input.baseUploadInput,
    isRemoteSyncBlocked: (organizationId: string) => {
      checkedOrganizationId = organizationId;
      remoteSyncBlocked =
        input.state.runtime.util.isRemoteSyncBlocked?.(organizationId) ?? false;
      return remoteSyncBlocked;
    },
    onBindEnded: (status: DocumentVersionBindStatus) => {
      bindEnd = status;
      input.baseUploadInput.onBindEnded?.(status);
    },
    onStageResolved,
  };
  let uploadError: unknown;
  let uploadThrew = false;
  let uploaded = await tryUploadDocumentAttachment({
    blobAttachments: input.blobAttachments,
    documentId: input.state.record?.documentId ?? input.state.localId,
    input: {
      ...baseUploadInput,
      writerProjection: input.writerProjection ?? undefined,
    },
    onError: (error) => {
      uploadThrew = true;
      uploadError = error;
    },
    reportSecurityIncident: input.state.runtime.util.reportSecurityIncident,
  });
  if (!uploaded && checkedOrganizationId !== undefined) {
    // The request itself may have produced the first 402 after the workflow's
    // preflight check. Re-read the same verified manifest org so that response
    // is treated as a billing pause even when there was no cached projection
    // available to trigger the retry path below.
    remoteSyncBlocked ||=
      input.state.runtime.util.isRemoteSyncBlocked?.(checkedOrganizationId) ??
      false;
  }
  if (
    !uploaded &&
    input.writerProjection &&
    !remoteSyncBlocked &&
    !endedForNewerDocument(bindEnd) &&
    !uploadThrew
  ) {
    // A stale cached writer projection may have caused an ambiguous null. Retry
    // once with a fresh projection, but do not immediately replay a concrete
    // thrown failure, an expected billing pause, or a bind refused because
    // the document advanced, which needs a pull rather than a projection.
    input.state.writerProjection = null;
    // Binding can return null after multipart staging succeeded. Carry that
    // resolved stage into the retry so it is resumed instead of orphaned.
    const retryUploadInput = withResumedMultipartStage(
      baseUploadInput,
      resolvedMultipartStage,
    );
    uploaded = await tryUploadDocumentAttachment({
      blobAttachments: input.blobAttachments,
      documentId: input.state.record?.documentId ?? input.state.localId,
      input: retryUploadInput,
      onError: (error) => {
        uploadError = error;
      },
      reportSecurityIncident: input.state.runtime.util.reportSecurityIncident,
    });
    if (!uploaded && checkedOrganizationId !== undefined) {
      remoteSyncBlocked ||=
        input.state.runtime.util.isRemoteSyncBlocked?.(checkedOrganizationId) ??
        false;
    }
  }

  return endedAttempt({ bindEnd, remoteSyncBlocked, uploaded, uploadError });
}

/** Whether an upload call's binds ended because the document advanced. */
function endedForNewerDocument(
  bindEnd: DocumentVersionBindStatus | null,
): boolean {
  return bindEnd === "documentChanged" || bindEnd === "abandoned";
}

function endedAttempt(input: {
  /** Null when the call threw or stopped before any bind. */
  readonly bindEnd: DocumentVersionBindStatus | null;
  readonly remoteSyncBlocked: boolean;
  readonly uploaded: UploadDocumentAttachmentResult | null;
  readonly uploadError: unknown;
}): AttachmentUploadAttempt {
  if (input.uploaded) return { status: "uploaded", uploaded: input.uploaded };
  if (input.remoteSyncBlocked) return { status: "syncBlocked" };
  if (endedForNewerDocument(input.bindEnd)) {
    return { status: "documentChanged" };
  }
  return { error: input.uploadError, status: "failed" };
}

async function tryUploadDocumentAttachment(input: {
  blobAttachments: BlobAttachmentService;
  documentId: string;
  input: AttachmentUploadInput;
  onError: (error: unknown) => void;
  reportSecurityIncident: DocumentStoreState["runtime"]["util"]["reportSecurityIncident"];
}): Promise<UploadDocumentAttachmentResult | null> {
  try {
    return await uploadInspectedDocumentAttachment(
      input.blobAttachments,
      input.input,
    );
  } catch (error) {
    await reportAndRethrowKeyingVerificationError(
      error,
      input.reportSecurityIncident,
      {
        objectId: input.documentId,
        objectKind: "document",
        operation: "document.attachment.upload",
      },
    );
    input.onError(error);
    return null;
  }
}

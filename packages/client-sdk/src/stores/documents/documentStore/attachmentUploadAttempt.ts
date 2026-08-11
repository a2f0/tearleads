import { reportAndRethrowKeyingVerificationError } from "../../../data/keyingProjectionVerification/error";
import { uploadPreparedDocumentAttachment as uploadDocumentAttachment } from "../../../workflows/blobs/upload";
import type { DocumentStoreState } from "./state";

export async function uploadAttachmentWithWriterProjectionRetry(input: {
  baseUploadInput: Parameters<typeof uploadDocumentAttachment>[0];
  state: DocumentStoreState;
  writerProjection: DocumentStoreState["writerProjection"];
}): Promise<{
  error: unknown;
  remoteSyncBlocked: boolean;
  uploaded: Awaited<ReturnType<typeof uploadDocumentAttachment>>;
}> {
  let remoteSyncBlocked = false;
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
    onStageResolved,
  };
  let uploadError: unknown;
  let uploadThrew = false;
  let uploaded = await tryUploadDocumentAttachment({
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
    !uploadThrew
  ) {
    // A stale cached writer projection may have caused an ambiguous null. Retry
    // once with a fresh projection, but do not immediately replay a concrete
    // thrown failure or an expected billing pause.
    input.state.writerProjection = null;
    // Binding can return null after multipart staging succeeded. Carry that
    // resolved stage into the retry so it is resumed instead of orphaned.
    const retryUploadInput = resolvedMultipartStage
      ? {
          ...baseUploadInput,
          multipart: {
            ...(baseUploadInput.multipart ?? {}),
            partSize: resolvedMultipartStage.partSize,
            resumeStageId: resolvedMultipartStage.stageId,
          },
        }
      : baseUploadInput;
    uploaded = await tryUploadDocumentAttachment({
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

  if (remoteSyncBlocked) {
    uploadError = undefined;
  }
  return { error: uploadError, remoteSyncBlocked, uploaded };
}

async function tryUploadDocumentAttachment(input: {
  documentId: string;
  input: Parameters<typeof uploadDocumentAttachment>[0];
  onError: (error: unknown) => void;
  reportSecurityIncident: DocumentStoreState["runtime"]["util"]["reportSecurityIncident"];
}): ReturnType<typeof uploadDocumentAttachment> {
  try {
    return await uploadDocumentAttachment(input.input);
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

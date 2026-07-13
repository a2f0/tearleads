import { uploadDocumentAttachment } from "../../../workflows/blobs";
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
  const baseUploadInput = {
    ...input.baseUploadInput,
    isRemoteSyncBlocked: (organizationId: string) => {
      checkedOrganizationId = organizationId;
      remoteSyncBlocked =
        input.state.runtime.util.isRemoteSyncBlocked?.(organizationId) ?? false;
      return remoteSyncBlocked;
    },
  };
  let uploadError: unknown;
  let uploaded = await tryUploadDocumentAttachment({
    input: {
      ...baseUploadInput,
      writerProjection: input.writerProjection ?? undefined,
    },
    onError: (error) => {
      uploadError = error;
    },
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
  if (!uploaded && input.writerProjection && !remoteSyncBlocked) {
    // A stale cached writer projection may have caused the rejection. Retry
    // once with a fresh projection, but never turn an expected billing pause
    // into a second attempt or a failed upload lane.
    input.state.writerProjection = null;
    uploaded = await tryUploadDocumentAttachment({
      input: baseUploadInput,
      onError: (error) => {
        uploadError = error;
      },
    });
    if (!uploaded && checkedOrganizationId !== undefined) {
      remoteSyncBlocked ||=
        input.state.runtime.util.isRemoteSyncBlocked?.(checkedOrganizationId) ??
        false;
    }
  }

  return { error: uploadError, remoteSyncBlocked, uploaded };
}

async function tryUploadDocumentAttachment(input: {
  input: Parameters<typeof uploadDocumentAttachment>[0];
  onError: (error: unknown) => void;
}): ReturnType<typeof uploadDocumentAttachment> {
  try {
    return await uploadDocumentAttachment(input.input);
  } catch (error) {
    input.onError(error);
    return null;
  }
}

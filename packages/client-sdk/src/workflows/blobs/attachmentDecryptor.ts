import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type { DecryptDocumentAttachmentBlobInput } from "../../data/documents/blob/shared/types";
import { isKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import { decryptDocumentAttachmentBlob } from "./decrypt";

interface AttachmentProjectionApi {
  evictDocumentWriterProjection?(documentId: string): void;
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
}

/** One fresh proof fetch shared by a hydration or key-rewrap run. */
export function createAttachmentProofReader<Result>(
  apiClient: AttachmentProjectionApi,
  documentId: string,
  read: (input: DecryptDocumentAttachmentBlobInput) => Promise<Result>,
) {
  let refreshed: Promise<DocumentWriterProjectionResponse | null> | undefined;
  const refresh = () => {
    refreshed ??= (async () => {
      apiClient.evictDocumentWriterProjection?.(documentId);
      return apiClient.getDocumentWriterProjection(documentId);
    })();
    return refreshed;
  };
  return async (input: DecryptDocumentAttachmentBlobInput) => {
    try {
      return await read(input);
    } catch (error) {
      if (
        !isKeyingVerificationError(error) ||
        error.code !== "missing_dependency"
      )
        throw error;
      const writerProjection = await refresh();
      if (!writerProjection) throw error;
      // Retry the same binding and ciphertext with fully verified fresh proof.
      // A second missing dependency escapes; it cannot trigger another fetch.
      return read({ ...input, writerProjection });
    }
  };
}

export function createAttachmentDecryptor(
  apiClient: AttachmentProjectionApi,
  documentId: string,
) {
  return createAttachmentProofReader(
    apiClient,
    documentId,
    decryptDocumentAttachmentBlob,
  );
}

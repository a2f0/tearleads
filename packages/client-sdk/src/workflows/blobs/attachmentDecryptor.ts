import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { isKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import { decryptDocumentAttachmentBlob } from "./decrypt";

interface AttachmentProjectionApi {
  evictDocumentWriterProjection?(documentId: string): void;
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
}

/**
 * Proof material the cached projection lacks, such as a wrap-cited container
 * manifest that a fresher projection serves. Not integrity evidence.
 */
function isRefreshableProofDependency(error: unknown): boolean {
  return (
    error instanceof ProjectionDependencyUnavailableError ||
    (isKeyingVerificationError(error) && error.code === "missing_dependency")
  );
}

/** One fresh proof fetch shared by a hydration or key-rewrap run. */
export function createAttachmentProofReader<
  Input extends { writerProjection: DocumentWriterProjectionResponse },
  Result,
>(
  apiClient: AttachmentProjectionApi,
  documentId: string,
  read: (input: Input) => Promise<Result>,
) {
  let refreshed: Promise<DocumentWriterProjectionResponse | null> | undefined;
  const refresh = () => {
    refreshed ??= (async () => {
      apiClient.evictDocumentWriterProjection?.(documentId);
      return apiClient.getDocumentWriterProjection(documentId);
    })();
    return refreshed;
  };
  return async (input: Input) => {
    try {
      return await read(input);
    } catch (error) {
      if (!isRefreshableProofDependency(error)) throw error;
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

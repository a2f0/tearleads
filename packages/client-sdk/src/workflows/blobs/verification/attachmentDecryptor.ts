import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { ProjectionDependencyUnavailableError } from "../../../data/shared/dependencyUnavailable";
import { isKeyingVerificationError } from "../../../data/shared/securityIncidents";
import { decryptDocumentAttachmentBlob } from "../hydration/decrypt";

interface AttachmentProjectionApi {
  evictDocumentWriterProjection?(documentId: string): void;
  getDocumentWriterProjection(
    documentId: string,
    options?: { readonly stillCurrent?: (() => boolean) | undefined },
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

/**
 * One fresh proof fetch shared by a hydration or key-rewrap run. The run's
 * inputs share its scope, so the first refresh carries it.
 */
export function createAttachmentProofReader<
  Input extends {
    readonly stillCurrent?: (() => boolean) | undefined;
    writerProjection: DocumentWriterProjectionResponse;
  },
  Result,
>(
  apiClient: AttachmentProjectionApi,
  documentId: string,
  read: (input: Input) => Promise<Result>,
) {
  let refreshed: Promise<DocumentWriterProjectionResponse | null> | undefined;
  const refresh = (stillCurrent: Input["stillCurrent"]) => {
    refreshed ??= (async () => {
      apiClient.evictDocumentWriterProjection?.(documentId);
      return apiClient.getDocumentWriterProjection(documentId, {
        stillCurrent,
      });
    })();
    return refreshed;
  };
  return async (input: Input) => {
    try {
      return await read(input);
    } catch (error) {
      if (!isRefreshableProofDependency(error)) throw error;
      const writerProjection = await refresh(input.stillCurrent);
      // A retired refresh is the cancellation verification would raise.
      assertProjectionVerificationCurrent(input.stillCurrent);
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

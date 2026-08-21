import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
import { readDocumentManifestIdentity } from "../../data/documents/blob/shared/readers";
import type {
  BlobAttachmentApi,
  DocumentManifestIdentity,
} from "../../data/documents/blob/shared/types";
import { assertDocumentWriterProjectionConsistent } from "../../data/documents/shared/projection";
import {
  type ProjectionVerificationOptions,
  projectionVerificationOptions,
} from "../../data/documents/shared/types";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

/**
 * Shared prologue for blob attachment mutations (upload/detach): resolve the
 * document writer projection, verify its consistency, confirm it targets the
 * mutated document, and gate on a blocked organization. Returns null when the
 * projection is unavailable or the organization's remote sync is blocked.
 */
export async function resolveBlobMutationWriterProjection(
  input: {
    apiClient: Pick<BlobAttachmentApi, "getDocumentWriterProjection">;
    documentId: string;
    /** Prefix for the wrong-document error, e.g. "Blob attachment detach". */
    errorLabel: string;
    execSql?: ExecSql | undefined;
    isRemoteSyncBlocked?: ((organizationId: string) => boolean) | undefined;
    writerProjection?: DocumentWriterProjectionResponse | undefined;
  } & ProjectionVerificationOptions,
): Promise<{
  manifestIdentity: DocumentManifestIdentity;
  writerProjection: DocumentWriterProjectionResponse;
} | null> {
  const writerProjection =
    input.writerProjection ??
    (await input.apiClient.getDocumentWriterProjection(input.documentId));
  if (!writerProjection) {
    return null;
  }

  await assertDocumentWriterProjectionConsistent(writerProjection, {
    execSql: input.execSql,
    ...projectionVerificationOptions(input),
  });
  const manifestIdentity = readDocumentManifestIdentity(writerProjection);
  if (manifestIdentity.documentId !== input.documentId) {
    throw new Error(
      `${input.errorLabel} writer projection targets wrong document`,
    );
  }
  if (input.isRemoteSyncBlocked?.(manifestIdentity.organizationId)) {
    return null;
  }

  return { manifestIdentity, writerProjection };
}

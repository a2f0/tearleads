import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { DOCUMENT_PROJECTION_ERROR_CODES } from "@tearleads/validators/response";
import {
  DocumentContentKeyBundleError,
  getLatestDocumentContentKeyBundleProjection,
} from "../../access/read/documentContentKeyStore";
import type { resolveCurrentDocumentKekTargets } from "../../access/read/documentKekTargets";
import { DocumentWriterProjectionError } from "./writerProjectionError";

export async function loadWriterProjectionContentKey(
  executor: DatabaseSession,
  documentId: string,
  documentKekTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >,
): Promise<
  NonNullable<
    Awaited<ReturnType<typeof getLatestDocumentContentKeyBundleProjection>>
  >
> {
  try {
    const contentKeyBundle = await getLatestDocumentContentKeyBundleProjection(
      { currentTargets: documentKekTargets, documentId },
      executor,
    );
    if (!contentKeyBundle)
      throw new DocumentWriterProjectionError(
        "Document content-key bundle missing",
        409,
        DOCUMENT_PROJECTION_ERROR_CODES.contentKeyBundleMissing,
      );
    return contentKeyBundle;
  } catch (error) {
    if (error instanceof DocumentContentKeyBundleError)
      throw new DocumentWriterProjectionError(error.message, 409, error.code);
    throw error;
  }
}

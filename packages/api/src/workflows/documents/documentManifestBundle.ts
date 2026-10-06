import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { documents } from "@tearleads/api-shared/schema";
import {
  type AccessManifestBundleWireResponse,
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  DOCUMENT_PROJECTION_ERROR_CODES,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  getAccessManifestBundle,
  getCurrentAccessManifestHead,
} from "../../access/read/accessManifestStore";
import { createProjectionReaders } from "../../keyingProjectionRecords";
import { DocumentWriterProjectionError } from "./writerProjectionError";

const { accessManifestRecord, verifiedAccessEventRecord, readCanonicalRecord } =
  createProjectionReaders(
    (message) => new DocumentWriterProjectionError(message, 409),
  );

export function toAccessManifestBundleWireResponse(
  input: NonNullable<Awaited<ReturnType<typeof getAccessManifestBundle>>>,
): AccessManifestBundleWireResponse {
  return {
    event: verifiedAccessEventRecord(input.event),
    manifest: accessManifestRecord(input.manifest),
    manifestHash: input.manifestHash,
    state: readCanonicalRecord(input.state, "Document manifest state"),
  };
}

export async function loadCurrentDocumentManifestBundle(
  executor: DatabaseSession,
  documentId: string,
): Promise<AccessManifestBundleWireResponse> {
  const head = await getCurrentAccessManifestHead(
    "document",
    documentId,
    executor,
  );
  if (!head) {
    // A missing head alone is not proof of deletion — only the documents row
    // is. Clients tear down their local copy on the coded 404, so emit it
    // solely when the row is positively absent; a headless-but-present row is
    // an anomalous state that must surface as a conflict, never as a wipe.
    const [document] = await executor
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    if (!document) {
      throw new DocumentWriterProjectionError(
        "Document not found",
        404,
        DOCUMENT_NOT_FOUND_ERROR_CODE,
      );
    }
    throw new DocumentWriterProjectionError(
      "Document manifest head missing",
      409,
      DOCUMENT_PROJECTION_ERROR_CODES.headMissing,
    );
  }

  const bundle = await getAccessManifestBundle(head.manifestHash, executor);
  if (bundle?.manifest.objectKind !== "document") {
    throw new DocumentWriterProjectionError(
      "Document manifest bundle missing",
      409,
    );
  }

  return toAccessManifestBundleWireResponse(bundle);
}

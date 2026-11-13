import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  documentManifestObservations,
  documents,
} from "@tearleads/api-shared/schema";
import {
  type AccessManifestBundleWireResponse,
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  DOCUMENT_PROJECTION_ERROR_CODES,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import {
  getAccessManifestBundle,
  getCurrentAccessManifestHead,
} from "../../access/read/accessManifestStore";
import {
  projectionAccessManifestRecord,
  projectionVerifiedAccessEventRecord,
} from "../../keyingProjectionRecords";
import { copyProjectionRecord } from "../../keyingProjectionSchemas";
import type { AccessManifestVerificationMarkerStore } from "../containers/writerProjection/verificationMarkers";
import { DocumentWriterProjectionError } from "./writerProjectionError";

function projectionError(message: string): DocumentWriterProjectionError {
  return new DocumentWriterProjectionError(message, 409);
}

export function toAccessManifestBundleWireResponse(
  input: NonNullable<Awaited<ReturnType<typeof getAccessManifestBundle>>>,
): AccessManifestBundleWireResponse {
  return {
    event: projectionVerifiedAccessEventRecord(input.event),
    manifest: projectionAccessManifestRecord(input.manifest),
    manifestHash: input.manifestHash,
    state: copyProjectionRecord(
      input.state,
      "Document manifest state",
      projectionError,
    ),
  };
}

/** The current head's bundle; its row's marker seeds `markers`, if given. */
export async function loadCurrentDocumentManifestBundle(
  executor: DatabaseSession,
  documentId: string,
  markers?: AccessManifestVerificationMarkerStore,
): Promise<AccessManifestBundleWireResponse> {
  const head = await getCurrentAccessManifestHead(
    "document",
    documentId,
    executor,
  );
  return loadDocumentManifestBundleForHead(executor, documentId, head, markers);
}

/** The unique user/document/hash observation joins the exact head being served. */
export async function loadObservedDocumentManifestBundle(
  executor: DatabaseSession,
  documentId: string,
  userId: string,
  markers: AccessManifestVerificationMarkerStore,
): Promise<{ bundle: AccessManifestBundleWireResponse; observed: boolean }> {
  const [row] = await executor
    .select({
      head: accessManifestHeads,
      observationId: documentManifestObservations.id,
    })
    .from(accessManifestHeads)
    .leftJoin(
      documentManifestObservations,
      and(
        eq(documentManifestObservations.userId, userId),
        eq(documentManifestObservations.documentId, documentId),
        eq(
          documentManifestObservations.manifestHash,
          accessManifestHeads.manifestHash,
        ),
      ),
    )
    .where(
      and(
        eq(accessManifestHeads.objectKind, "document"),
        eq(accessManifestHeads.objectId, documentId),
      ),
    )
    .limit(1);
  return {
    bundle: await loadDocumentManifestBundleForHead(
      executor,
      documentId,
      row?.head ?? null,
      markers,
    ),
    observed: row?.observationId != null,
  };
}

async function loadDocumentManifestBundleForHead(
  executor: DatabaseSession,
  documentId: string,
  head: Awaited<ReturnType<typeof getCurrentAccessManifestHead>>,
  markers?: AccessManifestVerificationMarkerStore,
): Promise<AccessManifestBundleWireResponse> {
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

  markers?.seed(bundle);
  return toAccessManifestBundleWireResponse(bundle);
}

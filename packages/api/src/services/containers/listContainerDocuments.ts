import type { ListContainerDocumentsResponse } from "@tearleads/validators/response";
import { desc, eq, inArray } from "drizzle-orm";
import {
  canReadContainerAccess,
  resolveContainerAccessState,
} from "../../access/containerAccess";
import {
  canReadDocumentAccess,
  resolveDocumentAccessStates,
} from "../../access/documentAccess";
import {
  containerMetadataDocuments,
  containers,
  documentContainerLinks,
  documents,
} from "../../schema";
import { uniqueSortedStrings } from "../../utils/array";
import type { ApiServiceRuntime } from "../runtime";

export class ListContainerDocumentsError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404,
  ) {
    super(message);
  }
}

async function requireReadableContainer(
  runtime: ApiServiceRuntime,
  containerId: string,
  userId: string,
) {
  const [container] = await runtime.db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);

  if (!container) {
    throw new ListContainerDocumentsError("Container not found", 404);
  }

  const containerAccess = await resolveContainerAccessState(
    containerId,
    runtime.db,
  );
  if (!containerAccess || !canReadContainerAccess(containerAccess, userId)) {
    throw new ListContainerDocumentsError("Forbidden", 403);
  }
}

async function loadContainerDocumentIds(
  runtime: ApiServiceRuntime,
  containerId: string,
): Promise<string[]> {
  const [metadataDocument] = await runtime.db
    .select({ documentId: containerMetadataDocuments.documentId })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.containerId, containerId))
    .limit(1);
  const metadataDocumentId = metadataDocument
    ? String(metadataDocument.documentId)
    : null;

  const linkedDocumentIdRows = await runtime.db
    .select({
      documentId: documentContainerLinks.documentId,
    })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.containerId, containerId));

  return uniqueSortedStrings(
    linkedDocumentIdRows
      .map((row) => row.documentId)
      .filter((documentId) => documentId !== metadataDocumentId),
  );
}

async function loadCreatedAtByDocumentId(
  runtime: ApiServiceRuntime,
  documentIds: ReadonlyArray<string>,
) {
  const documentRows =
    documentIds.length === 0
      ? []
      : await runtime.db
          .select({
            createdAt: documents.createdAt,
            documentId: documents.id,
          })
          .from(documents)
          .where(inArray(documents.id, documentIds))
          .orderBy(desc(documents.createdAt));

  return new Map(documentRows.map((row) => [row.documentId, row.createdAt]));
}

async function loadLinkedContainerIdsByDocumentId(
  runtime: ApiServiceRuntime,
  documentIds: ReadonlyArray<string>,
) {
  const linkedContainerRows =
    documentIds.length === 0
      ? []
      : await runtime.db
          .select({
            containerId: documentContainerLinks.containerId,
            documentId: documentContainerLinks.documentId,
          })
          .from(documentContainerLinks)
          .where(inArray(documentContainerLinks.documentId, documentIds));
  const linkedContainerIdsByDocumentId = new Map<string, string[]>();

  for (const documentId of documentIds) {
    linkedContainerIdsByDocumentId.set(documentId, []);
  }

  for (const row of linkedContainerRows) {
    linkedContainerIdsByDocumentId.get(row.documentId)?.push(row.containerId);
  }

  for (const [
    documentId,
    linkedContainerIds,
  ] of linkedContainerIdsByDocumentId) {
    linkedContainerIdsByDocumentId.set(
      documentId,
      uniqueSortedStrings(linkedContainerIds),
    );
  }

  return linkedContainerIdsByDocumentId;
}

export async function listContainerDocuments(
  runtime: ApiServiceRuntime,
  containerId: string,
  userId: string,
): Promise<ListContainerDocumentsResponse> {
  await requireReadableContainer(runtime, containerId, userId);

  const documentIds = await loadContainerDocumentIds(runtime, containerId);
  const createdAtByDocumentId = await loadCreatedAtByDocumentId(
    runtime,
    documentIds,
  );
  const accessStateByDocumentId = await resolveDocumentAccessStates(
    documentIds,
    runtime.db,
  );
  const linkedContainerIdsByDocumentId =
    await loadLinkedContainerIdsByDocumentId(runtime, documentIds);

  const responseBody: ListContainerDocumentsResponse = [];

  for (const documentId of documentIds) {
    const accessState = accessStateByDocumentId.get(documentId);
    if (!accessState || !canReadDocumentAccess(accessState, userId)) {
      continue;
    }

    responseBody.push({
      createdAt:
        createdAtByDocumentId.get(documentId)?.toISOString() ??
        new Date(0).toISOString(),
      currentAccessEpoch: accessState.currentAccessEpoch,
      currentAccessStateHash: accessState.accessStateHash,
      id: documentId,
      linkedContainerIds: linkedContainerIdsByDocumentId.get(documentId) ?? [],
      referencedPrincipals: accessState.referencedPrincipals,
    });
  }

  return responseBody;
}

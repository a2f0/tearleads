import type { ListContainerDocumentsResponse } from "@tearleads/validators/response";
import { desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import {
  canReadContainerAccess,
  resolveContainerAccessState,
} from "../../access/containerAccess";
import {
  canReadDocumentAccess,
  listRecipientEncapsulationPublicKeys,
  resolveDocumentAccessStates,
} from "../../access/documentAccess";
import { db } from "../../adapters/postgres";
import { requireAuth } from "../../middleware/session";
import {
  containerMetadataDocuments,
  containers,
  documentContainerLinks,
  documents,
} from "../../schema";
import { uniqueSortedStrings } from "../../utils/array";

export const listContainerDocumentsRoute = new Hono();

listContainerDocumentsRoute.get(
  "/containers/:containerId/documents",
  requireAuth,
  async (c) => {
    const session = c.get("session");
    const containerId = c.req.param("containerId");

    const [container] = await db
      .select({ id: containers.id })
      .from(containers)
      .where(eq(containers.id, containerId))
      .limit(1);

    if (!container) {
      return c.json({ error: "Container not found" }, 404);
    }

    const containerAccess = await resolveContainerAccessState(containerId);
    if (
      !containerAccess ||
      !canReadContainerAccess(containerAccess, session.userId)
    ) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const [metadataDocument] = await db
      .select({ documentId: containerMetadataDocuments.documentId })
      .from(containerMetadataDocuments)
      .where(eq(containerMetadataDocuments.containerId, containerId))
      .limit(1);
    const metadataDocumentId = metadataDocument
      ? String(metadataDocument.documentId)
      : null;

    const linkedDocumentIdRows = await db
      .select({
        documentId: documentContainerLinks.documentId,
      })
      .from(documentContainerLinks)
      .where(eq(documentContainerLinks.containerId, containerId));

    const documentIds = uniqueSortedStrings(
      linkedDocumentIdRows
        .map((row) => row.documentId)
        .filter((documentId) => documentId !== metadataDocumentId),
    );
    const documentRows =
      documentIds.length === 0
        ? []
        : await db
            .select({
              createdAt: documents.createdAt,
              documentId: documents.id,
            })
            .from(documents)
            .where(inArray(documents.id, documentIds))
            .orderBy(desc(documents.createdAt));
    const createdAtByDocumentId = new Map(
      documentRows.map((row) => [row.documentId, row.createdAt]),
    );
    const accessStateByDocumentId =
      await resolveDocumentAccessStates(documentIds);
    const linkedContainerRows =
      documentIds.length === 0
        ? []
        : await db
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

    const responseBody: ListContainerDocumentsResponse = [];

    for (const documentRow of documentRows) {
      const accessState = accessStateByDocumentId.get(documentRow.documentId);
      if (!accessState || !canReadDocumentAccess(accessState, session.userId)) {
        continue;
      }

      responseBody.push({
        createdAt:
          createdAtByDocumentId.get(documentRow.documentId)?.toISOString() ??
          new Date(0).toISOString(),
        currentAccessEpoch: accessState.currentAccessEpoch,
        id: documentRow.documentId,
        linkedContainerIds:
          linkedContainerIdsByDocumentId.get(documentRow.documentId) ?? [],
        recipientEncapsulationPublicKeys:
          listRecipientEncapsulationPublicKeys(accessState),
      });
    }

    return c.json<ListContainerDocumentsResponse>(responseBody);
  },
);

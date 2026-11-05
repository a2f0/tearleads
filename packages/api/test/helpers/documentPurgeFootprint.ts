import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifests,
  containerDocumentSyncTombstones,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documentContentWriteHeaders,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import { currentDocumentLinkRows } from "./currentDocumentLinks";

/** Per-table row counts for one document, before and after a purge. */
interface DocumentRowPresence {
  readonly accessEvents: number;
  readonly accessManifestDocumentLinkProjection: number;
  readonly accessManifestHeads: number;
  readonly accessManifests: number;
  readonly currentDocumentLinks: number;
  readonly documentContentKeyEpochs: number;
  readonly documentContentKeyTargets: number;
  readonly documentContentWriteHeaders: number;
  readonly documentUpdates: number;
  readonly documents: number;
}

export async function countDocumentRows(
  documentId: string,
): Promise<DocumentRowPresence> {
  const [
    documentRows,
    linkRows,
    manifestRows,
    manifestHeadRows,
    eventRows,
    epochRows,
    targetRows,
    writeHeaderRows,
    updateRows,
    linkProjectionRows,
  ] = await Promise.all([
    db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, documentId)),
    currentDocumentLinkRows(documentId),
    db
      .select({ manifestHash: accessManifests.manifestHash })
      .from(accessManifests)
      .where(
        and(
          eq(accessManifests.objectKind, "document"),
          eq(accessManifests.objectId, documentId),
        ),
      ),
    db
      .select({ manifestHash: accessManifestHeads.manifestHash })
      .from(accessManifestHeads)
      .where(
        and(
          eq(accessManifestHeads.objectKind, "document"),
          eq(accessManifestHeads.objectId, documentId),
        ),
      ),
    db
      .select({ eventHash: accessEvents.eventHash })
      .from(accessEvents)
      .where(
        and(
          eq(accessEvents.objectKind, "document"),
          eq(accessEvents.objectId, documentId),
        ),
      ),
    db
      .select({ id: documentContentKeyEpochs.id })
      .from(documentContentKeyEpochs)
      .where(eq(documentContentKeyEpochs.documentId, documentId)),
    db
      .select({ id: documentContentKeyTargets.id })
      .from(documentContentKeyTargets)
      .innerJoin(
        documentContentKeyEpochs,
        eq(
          documentContentKeyTargets.documentContentKeyEpochId,
          documentContentKeyEpochs.id,
        ),
      )
      .where(eq(documentContentKeyEpochs.documentId, documentId)),
    db
      .select({ updateId: documentContentWriteHeaders.updateId })
      .from(documentContentWriteHeaders)
      .where(eq(documentContentWriteHeaders.documentId, documentId)),
    db
      .select({ id: documentUpdates.id })
      .from(documentUpdates)
      .where(eq(documentUpdates.documentId, documentId)),
    db
      .select({ documentId: accessManifestDocumentLinkProjection.documentId })
      .from(accessManifestDocumentLinkProjection)
      .where(eq(accessManifestDocumentLinkProjection.documentId, documentId)),
  ]);

  return {
    accessEvents: eventRows.length,
    accessManifestDocumentLinkProjection: linkProjectionRows.length,
    accessManifestHeads: manifestHeadRows.length,
    accessManifests: manifestRows.length,
    currentDocumentLinks: linkRows.length,
    documentContentKeyEpochs: epochRows.length,
    documentContentKeyTargets: targetRows.length,
    documentContentWriteHeaders: writeHeaderRows.length,
    documentUpdates: updateRows.length,
    documents: documentRows.length,
  };
}

export async function countTombstones(input: {
  readonly containerId: string;
  readonly documentId: string;
}): Promise<number> {
  const rows = await db
    .select({ id: containerDocumentSyncTombstones.id })
    .from(containerDocumentSyncTombstones)
    .where(
      and(
        eq(containerDocumentSyncTombstones.containerId, input.containerId),
        eq(containerDocumentSyncTombstones.documentId, input.documentId),
      ),
    );

  return rows.length;
}

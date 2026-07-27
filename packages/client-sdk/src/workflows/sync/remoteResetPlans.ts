import { createDocument, exportAllUpdates } from "@tearleads/loro";
import { createPendingUpdateFields } from "../../data/documentSync";
import { getDocumentAttachments } from "../../data/documents/documentContent";
import { DOCUMENTS_APP_KIND } from "../../data/persistence/documents/documentsPersistence";
import {
  documentAttachmentBlobProjection,
  documentHistoryCheckpoints,
  documentHistoryUpdates,
  documents,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { importDocumentHistoryTailUpdates } from "../documents/historyContent";

export interface ResetDocumentUpdate {
  readonly appKind: string;
  readonly localId: string;
  readonly updateData: string;
  readonly partialStartVersionVector: string;
  readonly partialEndVersionVector: string;
  readonly sourceVersionVector: string | null;
}

export interface ResetAttachmentUpload {
  readonly byteLength: number;
  readonly localId: string;
  readonly mimeType: string | null;
  readonly name: string;
  readonly slotId: string;
  readonly storageKey: string;
}

type ResetContentDoc = Awaited<ReturnType<typeof createDocument>>;

function historyScopeKey(appKind: string, localId: string): string {
  return `${appKind} ${localId}`;
}

function buildResetUpdate(input: {
  appKind: string;
  doc: ResetContentDoc;
  localId: string;
}): ResetDocumentUpdate | null {
  const fields = createPendingUpdateFields(exportAllUpdates(input.doc));
  if (!fields) {
    return null;
  }

  return {
    appKind: input.appKind,
    localId: input.localId,
    updateData: fields.updateData,
    partialStartVersionVector: fields.partialStartVersionVector,
    partialEndVersionVector: fields.partialEndVersionVector,
    sourceVersionVector: fields.sourceVersionVector ?? null,
  };
}

/**
 * Reconstruct every persisted document's content from the durable-history
 * tables (checkpoint + tail) — the only content source. A scope without a
 * checkpoint (a discovered shell that never hydrated) gets no doc: it has no
 * content to republish and no attachments to requeue. The mode-sniffing tail
 * import handles both content kinds — full-history snapshots (documents) and
 * exported-updates blobs (container metadata).
 */
async function buildResetContentDocs(
  db: ReturnType<typeof getClientSQLitePersistenceRuntime>["db"],
): Promise<Map<string, ResetContentDoc>> {
  const checkpointRows = await db
    .select({
      appKind: documentHistoryCheckpoints.appKind,
      localId: documentHistoryCheckpoints.localId,
      snapshot: documentHistoryCheckpoints.snapshot,
    })
    .from(documentHistoryCheckpoints);
  const tailRows = await db
    .select({
      appKind: documentHistoryUpdates.appKind,
      localId: documentHistoryUpdates.localId,
      updateData: documentHistoryUpdates.updateData,
    })
    .from(documentHistoryUpdates)
    .orderBy(documentHistoryUpdates.createdAt, documentHistoryUpdates.id);

  const tailByScope = new Map<string, string[]>();
  for (const row of tailRows) {
    const key = historyScopeKey(row.appKind, row.localId);
    const tail = tailByScope.get(key);
    if (tail) {
      tail.push(row.updateData);
    } else {
      tailByScope.set(key, [row.updateData]);
    }
  }

  const contentDocByScope = new Map<string, ResetContentDoc>();
  await Promise.all(
    checkpointRows.map(async (row) => {
      const key = historyScopeKey(row.appKind, row.localId);
      const doc = await createDocument(
        `remote-reset:${row.appKind}:${row.localId}`,
      );
      importDocumentHistoryTailUpdates(doc, [
        row.snapshot,
        ...(tailByScope.get(key) ?? []),
      ]);
      contentDocByScope.set(key, doc);
    }),
  );
  return contentDocByScope;
}

export async function buildResetPlans(execSql: ExecSql): Promise<{
  readonly attachmentUploads: ResetAttachmentUpload[];
  readonly documentUpdates: ResetDocumentUpdate[];
}> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const documentRows = await db
    .select({
      appKind: documents.appKind,
      localId: documents.localId,
    })
    .from(documents);
  const attachmentRows = await db
    .select({
      byteLength: documentAttachmentBlobProjection.byteLength,
      localId: documentAttachmentBlobProjection.localId,
      mimeType: documentAttachmentBlobProjection.mimeType,
      slotId: documentAttachmentBlobProjection.slotId,
      storageKey: documentAttachmentBlobProjection.storageKey,
    })
    .from(documentAttachmentBlobProjection);
  const contentDocByScope = await buildResetContentDocs(db);
  const documentUpdates = documentRows.flatMap((row) => {
    const doc = contentDocByScope.get(
      historyScopeKey(row.appKind, row.localId),
    );
    if (!doc) {
      return [];
    }
    const update = buildResetUpdate({
      appKind: row.appKind,
      doc,
      localId: row.localId,
    });
    return update ? [update] : [];
  });
  const attachmentNameMaps = new Map<string, Map<string, string>>();
  const attachmentLocalIds = [
    ...new Set(attachmentRows.map((attachment) => attachment.localId)),
  ];
  for (const localId of attachmentLocalIds) {
    const doc = contentDocByScope.get(
      historyScopeKey(DOCUMENTS_APP_KIND, localId),
    );
    if (!doc) {
      continue;
    }
    attachmentNameMaps.set(
      localId,
      new Map(
        getDocumentAttachments(doc).map((attachment) => [
          attachment.slotId,
          attachment.name,
        ]),
      ),
    );
  }

  // A reset re-uploads the local attachments as pending work, and the durable
  // document decides which rows those are: a row whose slot the snapshot no
  // longer advertises belongs to an unlink, and re-queueing it would resurrect
  // an attachment the document dropped. Reading the snapshot rather than the
  // detach marker keeps the two halves of an interrupted unlink consistent —
  // there the marker is set but the snapshot still advertises the slot, and the
  // reset has to upload it to match the document it is about to republish.
  const attachmentUploads = attachmentRows.flatMap((attachment) => {
    const name = attachmentNameMaps
      .get(attachment.localId)
      ?.get(attachment.slotId);
    if (name === undefined) {
      return [];
    }

    return [
      {
        byteLength: attachment.byteLength,
        localId: attachment.localId,
        mimeType: attachment.mimeType,
        name,
        slotId: attachment.slotId,
        storageKey: attachment.storageKey,
      },
    ];
  });

  return { attachmentUploads, documentUpdates };
}

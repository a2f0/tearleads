import { createDocument, exportAllUpdates } from "@symcrypt/loro";
import { sql } from "drizzle-orm";
import { getDocumentAttachments } from "../../data/documents/documentContent";
import { createPendingUpdateFields } from "../../data/documents/documentSync";
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
  // Read the TAIL before the checkpoints (the same order the restore path
  // uses): a compaction landing between the two reads then yields old-tail +
  // new-checkpoint — a safe superset, since replay is idempotent by op
  // identity — whereas the reverse order could yield an old checkpoint plus
  // an already-emptied tail and republish stale content.
  const tailRows = await db
    .select({
      appKind: documentHistoryUpdates.appKind,
      localId: documentHistoryUpdates.localId,
      updateData: documentHistoryUpdates.updateData,
    })
    .from(documentHistoryUpdates)
    // Insertion order (see loadDocumentHistoryRestoreState): createdAt can
    // tie within a millisecond and the uuid tiebreak is random.
    .orderBy(sql`rowid`);
  const checkpointRows = await db
    .select({
      appKind: documentHistoryCheckpoints.appKind,
      localId: documentHistoryCheckpoints.localId,
      snapshot: documentHistoryCheckpoints.snapshot,
    })
    .from(documentHistoryCheckpoints);

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

  // Rebuild the UNION of checkpoint and tail scopes: a tail-only scope (a
  // crash landed the first edit's tail row before the birth checkpoint) may
  // hold the only durable copy of that edit, and dropping it from the reset
  // would discard it.
  const checkpointByScope = new Map(
    checkpointRows.map((row) => [
      historyScopeKey(row.appKind, row.localId),
      row,
    ]),
  );
  const scopes = new Map<string, { appKind: string; localId: string }>();
  for (const row of [...checkpointRows, ...tailRows]) {
    scopes.set(historyScopeKey(row.appKind, row.localId), {
      appKind: row.appKind,
      localId: row.localId,
    });
  }

  const contentDocByScope = new Map<string, ResetContentDoc>();
  await Promise.all(
    [...scopes.entries()].map(async ([key, scope]) => {
      const doc = await createDocument(
        `remote-reset:${scope.appKind}:${scope.localId}`,
      );
      const checkpoint = checkpointByScope.get(key);
      // An empty checkpoint blob (e.g. container metadata saved before any
      // update existed) carries no ops — importing it would throw and fail
      // the whole reset.
      importDocumentHistoryTailUpdates(
        doc,
        [
          ...(checkpoint ? [checkpoint.snapshot] : []),
          ...(tailByScope.get(key) ?? []),
        ].filter((blob) => blob.length > 0),
      );
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

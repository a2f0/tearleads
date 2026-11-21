import { base64ToBytes } from "@tearleads/encoding";
import { createDocument, importSnapshot } from "@tearleads/loro";
import { and, eq } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../../documents/documentConstants";
import {
  type DocumentAttachment,
  getDocumentAttachments,
} from "../../../documents/documentContent";
import { importDocumentHistoryTailUpdates } from "../../../documents/documentHistoryImport";
import { documentAttachmentBlobProjection } from "../../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import { getScopedPeerSeed } from "../../../sync/crdtPeerSeed";
import { selectDocumentHistoryRestoreState } from "../records/documentHistoryPersistence";
import type {
  AttachmentRemovalMarkerSettlement,
  LocalAttachmentRecord,
  SettleAttachmentRemovalMarkerInput,
} from "../types";
import { mapLocalAttachmentRecord } from "./attachmentRows";
import { upsertStoredAttachmentStagingRows } from "./attachmentStagingPersistence";
import { getDocumentScope } from "./documentRows";
import { queueDocumentAttachmentStorageKeys } from "./orphanSideRows";

async function readCommittedAttachment(
  tx: ClientSQLiteTransactionScope,
  localId: string,
  slotId: string,
): Promise<DocumentAttachment | undefined> {
  const history = await selectDocumentHistoryRestoreState(
    tx,
    getDocumentScope(localId),
  );
  if (!history) return undefined;
  const doc = await createDocument(await getScopedPeerSeed(DOCUMENTS_APP_KIND));
  try {
    if (history.snapshot) importSnapshot(doc, base64ToBytes(history.snapshot));
    importDocumentHistoryTailUpdates(
      doc,
      history.tailUpdates.map((update) => update.updateData),
    );
    return getDocumentAttachments(doc).find(
      (attachment) => attachment.slotId === slotId,
    );
  } finally {
    doc.free();
  }
}

async function selectSlotRow(
  tx: ClientSQLiteTransactionScope,
  localId: string,
  slotId: string,
): Promise<LocalAttachmentRecord | null> {
  const projection = documentAttachmentBlobProjection;
  const [row] = await tx
    .select({
      localId: projection.localId,
      slotId: projection.slotId,
      blobId: projection.blobId,
      storageKey: projection.storageKey,
      mimeType: projection.mimeType,
      byteLength: projection.byteLength,
      contentSha256: projection.contentSha256,
      detachedAt: projection.detachedAt,
    })
    .from(projection)
    .where(and(eq(projection.localId, localId), eq(projection.slotId, slotId)))
    .limit(1);
  return row ? mapLocalAttachmentRecord(row) : null;
}

async function writeSettlement(input: {
  localId: string;
  observedRow: LocalAttachmentRecord | null;
  settlement: AttachmentRemovalMarkerSettlement;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { localId, observedRow, settlement, tx } = input;
  if (settlement.write === "delete" && observedRow) {
    const projection = documentAttachmentBlobProjection;
    await tx
      .delete(projection)
      .where(
        and(
          eq(projection.localId, localId),
          eq(projection.slotId, observedRow.slotId),
          eq(projection.storageKey, observedRow.storageKey),
        ),
      )
      .run();
    // Another slot may hold the same copy; the reclaim checks references.
    await queueDocumentAttachmentStorageKeys(tx, [observedRow.storageKey]);
  }
  if (settlement.write === "upsert" && settlement.row) {
    await upsertStoredAttachmentStagingRows({
      createdAt: new Date().toISOString(),
      localId,
      staging: {
        localAttachments: [settlement.row],
        pendingAttachments: settlement.pending ? [settlement.pending] : [],
      },
      tx,
    });
  }
}

/**
 * Settle one removal marker against committed document history in a single
 * immediate transaction, so another pane's commit of the slot cannot land
 * between the check and the row write. Null when `stillCurrent` turned false
 * before commit; nothing was written then.
 */
export async function settleAttachmentRemovalMarker(
  execSql: ExecSql,
  input: SettleAttachmentRemovalMarkerInput,
): Promise<AttachmentRemovalMarkerSettlement | null> {
  const { localId, slotId } = input;
  const outcome = await getClientSQLitePersistenceRuntime(
    execSql,
  ).guardedTransaction(
    async (tx) => {
      const row = await selectSlotRow(tx, localId, slotId);
      const committed = await readCommittedAttachment(tx, localId, slotId);
      const settlement = input.settle({ committed, row });
      await writeSettlement({ localId, observedRow: row, settlement, tx });
      return settlement;
    },
    input.stillCurrent,
    { behavior: "immediate" },
  );
  return outcome.committed ? outcome.result : null;
}

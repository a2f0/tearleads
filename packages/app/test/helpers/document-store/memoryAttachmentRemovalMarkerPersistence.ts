import {
  type DocumentAttachment,
  type DocumentsPersistence,
  getDocumentAttachments,
  type LocalAttachmentRecord,
  type PendingAttachmentRecord,
} from "@tearleads/client-sdk";
import { base64ToBytes } from "@tearleads/encoding";
import {
  createDocument,
  getImportBlobMetadata,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";

async function readCommittedAttachment(
  history: Awaited<ReturnType<DocumentsPersistence["loadHistoryRestoreState"]>>,
  slotId: string,
): Promise<DocumentAttachment | undefined> {
  if (!history) return undefined;
  const doc = await createDocument("memory-attachment-marker-settle");
  try {
    if (history.snapshot) importSnapshot(doc, base64ToBytes(history.snapshot));
    const updates: Uint8Array[] = [];
    for (const { updateData } of history.tailUpdates) {
      const bytes = base64ToBytes(updateData);
      // Rotation baselines travel through the tail as snapshots.
      if (getImportBlobMetadata(bytes).mode === "snapshot") {
        importSnapshot(doc, bytes);
      } else {
        updates.push(bytes);
      }
    }
    if (updates.length > 0) importUpdates(doc, updates);
    return getDocumentAttachments(doc).find(
      (attachment) => attachment.slotId === slotId,
    );
  } finally {
    doc.free();
  }
}

/** Settle a removal marker against the fixture's committed history. */
export function createMemoryAttachmentRemovalMarkerPersistence(input: {
  getAttachments: () => LocalAttachmentRecord[];
  getPendingAttachments: () => PendingAttachmentRecord[];
  loadHistoryRestoreState: DocumentsPersistence["loadHistoryRestoreState"];
  setAttachments: (rows: LocalAttachmentRecord[]) => void;
  setPendingAttachments: (rows: PendingAttachmentRecord[]) => void;
}): DocumentsPersistence["settleAttachmentRemovalMarker"] {
  return async (execSql, request) => {
    const { localId, slotId } = request;
    const committed = await readCommittedAttachment(
      await input.loadHistoryRestoreState(execSql, localId),
      slotId,
    );
    // This synchronous section is the memory adapter's atomic commit boundary.
    const isSlot = (row: { localId: string; slotId: string }) =>
      row.localId === localId && row.slotId === slotId;
    const rows = input.getAttachments();
    const row = rows.find(isSlot) ?? null;
    const settlement = request.settle({ committed, row });
    // As in the SQLite adapter: currency is checked after the settle, right
    // before its writes commit.
    if (!request.stillCurrent()) return null;
    if (settlement.write === "delete" && row) {
      input.setAttachments(rows.filter((candidate) => candidate !== row));
    }
    if (settlement.write === "upsert" && settlement.row) {
      input.setAttachments([
        ...rows.filter((candidate) => !isSlot(candidate)),
        settlement.row,
      ]);
    }
    const { pending } = settlement;
    if (pending) {
      input.setPendingAttachments([
        ...input.getPendingAttachments().filter((row) => !isSlot(row)),
        pending,
      ]);
    }
    return settlement;
  };
}

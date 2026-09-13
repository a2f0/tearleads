import type {
  DocumentRecord,
  DocumentsPersistence,
  LocalAttachmentRecord,
} from "@tearleads/client-sdk";

export function createMemoryHydratedAttachmentPersistence(input: {
  getDocument: () => DocumentRecord | null;
  getAttachments: () => LocalAttachmentRecord[];
  setAttachments: (rows: LocalAttachmentRecord[]) => void;
}): DocumentsPersistence["saveHydratedAttachment"] {
  return async (_execSql, request) => {
    const {
      attachment,
      expectedStorageKey,
      expectedSnapshotEndVersion,
      stillCurrent,
    } = request;
    const record = input.getDocument();
    const document = record?.id === attachment.localId ? record : null;
    const rows = input.getAttachments();
    const existing = rows.find(
      (row) =>
        row.localId === attachment.localId && row.slotId === attachment.slotId,
    );
    // This synchronous section is the memory adapter's atomic commit boundary.
    if (
      (document?.snapshotEndVersion ?? null) !== expectedSnapshotEndVersion ||
      (existing?.storageKey ?? null) !== expectedStorageKey ||
      !stillCurrent()
    ) {
      return false;
    }
    input.setAttachments([
      ...rows.filter((row) => row !== existing),
      attachment,
    ]);
    return true;
  };
}

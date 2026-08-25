import type {
  DocumentRecord,
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
} from "@symcrypt/client-sdk";
import type { StoredHistoryState } from "./documentStoreSyncPersistenceState";
import { toHistoryRestoreState } from "./documentStoreSyncPersistenceState";

export function createMemoryDocumentStartupReads(input: {
  getDocument: () => DocumentRecord | null;
  getLocalAttachments: () => LocalAttachmentRecord[];
  getPendingAttachments: () => PendingAttachmentRecord[];
  historyByLocalId: ReadonlyMap<string, StoredHistoryState>;
}): Pick<
  DocumentsPersistence,
  "loadDocumentStoreState" | "loadDocumentWithHistoryRestoreState"
> {
  return {
    async loadDocumentWithHistoryRestoreState(_execSql, localId) {
      const document = input.getDocument();
      return {
        document: document?.id === localId ? document : null,
        historyRestoreState: toHistoryRestoreState(
          input.historyByLocalId.get(localId),
        ),
      };
    },
    async loadDocumentStoreState(_execSql, localId) {
      const document = input.getDocument();
      return {
        document: document?.id === localId ? document : null,
        historyRestoreState: toHistoryRestoreState(
          input.historyByLocalId.get(localId),
        ),
        localAttachments: input
          .getLocalAttachments()
          .filter((attachment) => attachment.localId === localId),
        pendingAttachments: input
          .getPendingAttachments()
          .filter((attachment) => attachment.localId === localId),
      };
    },
  };
}

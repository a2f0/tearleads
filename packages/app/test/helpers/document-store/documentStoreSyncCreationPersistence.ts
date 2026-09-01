import type {
  DocumentRecord,
  DocumentsPersistence,
  PendingUpdateRecord,
} from "@tearleads/client-sdk";
import type { StoredHistoryState } from "./documentStoreSyncPersistenceState";

export function createMemoryDocumentCreationPersistence(input: {
  getDocument: () => DocumentRecord | null;
  getPendingUpdates: () => PendingUpdateRecord[];
  historyByLocalId: Map<string, StoredHistoryState>;
  setDocument: (document: DocumentRecord | null) => void;
  setPendingUpdates: (updates: PendingUpdateRecord[]) => void;
}): Pick<DocumentsPersistence, "createDocumentWithHistoryCheckpoint"> {
  return {
    async createDocumentWithHistoryCheckpoint(
      execSql,
      nextDocument,
      historyCheckpoint,
      options,
      saveClientProjection,
    ) {
      if (options?.stillCurrent && !options.stillCurrent()) return null;
      if (input.getDocument()?.id === nextDocument.id) return null;
      const previousPendingUpdates = structuredClone(input.getPendingUpdates());
      const updatedAt = options?.updatedAt ?? "2026-04-06T00:00:00.000Z";
      try {
        input.setDocument(nextDocument);
        const tail = options?.pendingUpdate
          ? [
              {
                id: crypto.randomUUID(),
                origin: "local" as const,
                updateData: options.pendingUpdate.updateData,
              },
            ]
          : [];
        input.historyByLocalId.set(nextDocument.id, {
          checkpoint: historyCheckpoint,
          tail,
        });
        if (options?.pendingUpdate) {
          input.setPendingUpdates([
            ...input.getPendingUpdates(),
            { id: crypto.randomUUID(), ...options.pendingUpdate },
          ]);
        }
        await saveClientProjection(execSql, updatedAt);
        return updatedAt;
      } catch (error) {
        input.setDocument(null);
        input.setPendingUpdates(previousPendingUpdates);
        input.historyByLocalId.delete(nextDocument.id);
        throw error;
      }
    },
  };
}

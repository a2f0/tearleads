import type {
  DocumentRecord,
  DocumentSummary,
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingUpdateRecord,
} from "@tearleads/client-sdk";
import { createMemoryAbsentDocumentCleanup } from "./documentStoreAbsentCleanup";
import {
  canSaveMemoryDocument,
  memoryDocumentRecoveryGenerationMatches,
} from "./documentStoreRecoveryGeneration";
import { commitMemoryDocumentMutation } from "./memoryDocumentMutation";

export interface StoredDocumentsState {
  document: DocumentRecord | null;
  localAttachments: LocalAttachmentRecord[];
  pendingAttachments: PendingAttachmentRecord[];
  pendingUpdates: PendingUpdateRecord[];
}

export interface StoredHistoryState {
  checkpoint: { endVersionVector: string; snapshot: string } | null;
  tail: { id: string; origin: "local" | "remote"; updateData: string }[];
}

export type HistoryByLocalId = Map<string, StoredHistoryState>;
export type MutableDocumentsState = StoredDocumentsState;

export function documentSummaryFromRecord(
  record: DocumentRecord,
): DocumentSummary {
  return {
    accessStateHash: record.accessStateHash ?? null,
    id: record.id,
    containerId: record.containerId,
    documentKind: record.documentKind ?? "note",
    documentId: record.documentId,
    title: record.title ?? (record.text.trim() || "Untitled note"),
    updatedAt: "2026-04-06T00:00:00.000Z",
  };
}

function sameSecurityIdentity(
  current: DocumentRecord | null,
  expected: DocumentRecord,
): boolean {
  return (
    current !== null &&
    current.id === expected.id &&
    current.documentId === expected.documentId &&
    current.containerId === expected.containerId &&
    current.accessEpoch === expected.accessEpoch &&
    (current.accessStateHash ?? null) === (expected.accessStateHash ?? null) &&
    (current.effectiveAccessLevel ?? null) ===
      (expected.effectiveAccessLevel ?? null) &&
    (current.contentKeyBundle ?? null) ===
      (expected.contentKeyBundle ?? null) &&
    (current.documentKekTargets ?? null) ===
      (expected.documentKekTargets ?? null) &&
    (current.documentManifestBundle ?? null) ===
      (expected.documentManifestBundle ?? null) &&
    memoryDocumentRecoveryGenerationMatches(current, expected)
  );
}

export function createDocumentWritePersistence(
  state: MutableDocumentsState,
  historyByLocalId: HistoryByLocalId,
): Pick<
  DocumentsPersistence,
  | "createDocumentWithHistoryCheckpoint"
  | "commitDocumentMutation"
  | "settleAcceptedPendingUpdates"
  | "saveDocument"
  | "saveDocumentAndDeletePendingUpdates"
  | "deleteDocument"
  | "deleteDocumentIfMatches"
  | "deleteDocumentSideRowsIfAbsent"
  | "upsertDiscoveredDocument"
  | "relinkPersistedDocument"
> {
  const deleteSideRows = (localId: string) => {
    historyByLocalId.delete(localId);
    state.pendingUpdates = [];
    state.pendingAttachments = state.pendingAttachments.filter(
      (attachment) => attachment.localId !== localId,
    );
    state.localAttachments = state.localAttachments.filter(
      (attachment) => attachment.localId !== localId,
    );
  };
  return {
    async createDocumentWithHistoryCheckpoint(
      execSql,
      nextDocument,
      historyCheckpoint,
      options,
      saveClientProjection,
    ) {
      if (options?.stillCurrent && !options.stillCurrent()) return null;
      if (state.document?.id === nextDocument.id) return null;
      const previousState = structuredClone(state);
      const updatedAt = options?.updatedAt ?? "2026-04-06T00:00:00.000Z";
      try {
        state.document = nextDocument;
        const tail = options?.pendingUpdate
          ? [
              {
                id: crypto.randomUUID(),
                origin: "local" as const,
                updateData: options.pendingUpdate.updateData,
              },
            ]
          : [];
        historyByLocalId.set(nextDocument.id, {
          checkpoint: historyCheckpoint,
          tail,
        });
        if (options?.pendingUpdate) {
          state.pendingUpdates.push({
            id: crypto.randomUUID(),
            ...options.pendingUpdate,
          });
        }
        await saveClientProjection(execSql, updatedAt);
        return updatedAt;
      } catch (error) {
        Object.assign(state, previousState);
        historyByLocalId.delete(nextDocument.id);
        throw error;
      }
    },
    async commitDocumentMutation(execSql, input, saveClientProjection) {
      return commitMemoryDocumentMutation({
        execSql,
        getState: () => state,
        historyByLocalId,
        mutation: input,
        replaceState: (nextState) => Object.assign(state, nextState),
        saveClientProjection,
      });
    },
    async settleAcceptedPendingUpdates(_execSql, input) {
      if (sameSecurityIdentity(state.document, input.expectedRecord)) {
        const acceptedIds = new Set(input.pendingUpdateIds);
        state.pendingUpdates = state.pendingUpdates.filter(
          ({ id }) => !acceptedIds.has(id),
        );
      }
      return state.document;
    },
    async saveDocument(_execSql, nextDocument) {
      if (canSaveMemoryDocument(state.document, nextDocument)) {
        state.document = nextDocument;
      }
      return "2026-04-06T00:00:00.000Z";
    },
    async saveDocumentAndDeletePendingUpdates(
      _execSql,
      nextDocument,
      pendingUpdateIds,
    ) {
      if (!canSaveMemoryDocument(state.document, nextDocument)) {
        return "2026-04-06T00:00:00.000Z";
      }
      const acceptedIds = new Set(pendingUpdateIds);
      state.document = nextDocument;
      state.pendingUpdates = state.pendingUpdates.filter(
        ({ id }) => !acceptedIds.has(id),
      );
      return "2026-04-06T00:00:00.000Z";
    },
    async deleteDocument(_execSql, localId) {
      if (state.document?.id === localId) state.document = null;
      deleteSideRows(localId);
    },
    async deleteDocumentIfMatches(
      execSql,
      expectedRecord,
      deleteClientProjection,
    ) {
      if (!sameSecurityIdentity(state.document, expectedRecord)) return false;
      const previousState = structuredClone(state);
      const previousHistory = structuredClone(historyByLocalId);
      try {
        state.document = null;
        deleteSideRows(expectedRecord.id);
        await deleteClientProjection(execSql);
        return true;
      } catch (error) {
        Object.assign(state, previousState);
        historyByLocalId.clear();
        for (const [localId, history] of previousHistory) {
          historyByLocalId.set(localId, history);
        }
        throw error;
      }
    },
    ...createMemoryAbsentDocumentCleanup({
      deleteSideRows,
      documentExists: (localId) => state.document?.id === localId,
    }),
    async upsertDiscoveredDocument(_execSql, input) {
      const nextDocument: DocumentRecord = {
        accessEpoch: input.accessEpoch,
        accessStateHash: input.accessStateHash ?? null,
        containerId: input.containerId,
        documentId: input.documentId,
        id: state.document?.id ?? input.documentId,
        lastCommitLsn: null,
        recoveryGeneration: state.document?.recoveryGeneration ?? 0,
        snapshotEndVersion: state.document?.snapshotEndVersion ?? "",
        text: state.document?.text ?? "",
      };
      state.document = nextDocument;
      return documentSummaryFromRecord(nextDocument);
    },
    async relinkPersistedDocument(_execSql, input) {
      if (!state.document || state.document.id !== input.localId) return null;
      const nextDocument: DocumentRecord = {
        ...state.document,
        accessEpoch: Math.max(state.document.accessEpoch, input.accessEpoch),
        accessStateHash:
          input.accessStateHash ?? state.document.accessStateHash ?? null,
        containerId: input.containerId,
        documentId: input.documentId,
      };
      state.document = nextDocument;
      return documentSummaryFromRecord(nextDocument);
    },
  };
}

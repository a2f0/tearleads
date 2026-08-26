import type {
  DocumentRecord,
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingUpdateInsert,
  PendingUpdateRecord,
} from "@symcrypt/client-sdk";
import { invalidateMemoryDocumentPullContinuation } from "./documentPullContinuationPersistence";
import { createMemoryAbsentDocumentCleanup } from "./documentStoreAbsentCleanup";
import {
  canSaveMemoryDocument,
  enqueueMemoryPendingUpdate,
  memoryDocumentRecoveryGenerationMatches,
  memoryDocumentWriteFenceMatches,
  memoryHistoryFor,
} from "./documentStoreRecoveryGeneration";
import { createMemoryDocumentStartupReads } from "./documentStoreStartupReads";
import { buildMemoryDocumentSummaries } from "./documentStoreSummaries";
import { createMemoryDocumentCreationPersistence } from "./documentStoreSyncCreationPersistence";
import { createMemoryDocumentDeletionPersistence } from "./documentStoreSyncDeletionPersistence";
import type { StoredDocumentsState } from "./documentStoreSyncFixtures";
import {
  type StoredHistoryState,
  toHistoryRestoreState,
} from "./documentStoreSyncPersistenceState";
import { commitMemoryDocumentMutation } from "./memoryDocumentMutation";

export function createDocumentsPersistence(): DocumentsPersistence & {
  getState: () => StoredDocumentsState;
} {
  let document: DocumentRecord | null = null;
  let localAttachments: LocalAttachmentRecord[] = [];
  let pendingAttachments: PendingAttachmentRecord[] = [];
  let pendingUpdates: PendingUpdateRecord[] = [];
  const historyByLocalId = new Map<string, StoredHistoryState>();
  const historyFor = (localId: string): StoredHistoryState =>
    memoryHistoryFor(historyByLocalId, localId);
  const deleteSideRows = (localId: string) => {
    historyByLocalId.delete(localId);
    pendingUpdates = [];
    pendingAttachments = pendingAttachments.filter(
      (attachment) => attachment.localId !== localId,
    );
    localAttachments = localAttachments.filter(
      (attachment) => attachment.localId !== localId,
    );
  };
  const deletionPersistence = createMemoryDocumentDeletionPersistence({
    deleteSideRows,
    getDocument: () => document,
    restore: (previous) => {
      document = previous.document;
      pendingUpdates = previous.pendingUpdates;
      pendingAttachments = previous.pendingAttachments;
      localAttachments = previous.localAttachments;
      historyByLocalId.clear();
      for (const [localId, history] of previous.historyByLocalId) {
        historyByLocalId.set(localId, history);
      }
    },
    setDocument: (nextDocument) => {
      document = nextDocument;
    },
    snapshot: () =>
      structuredClone({
        document,
        historyByLocalId,
        localAttachments,
        pendingAttachments,
        pendingUpdates,
      }),
  });
  const creationPersistence = createMemoryDocumentCreationPersistence({
    getDocument: () => document,
    getPendingUpdates: () => pendingUpdates,
    historyByLocalId,
    setDocument: (nextDocument) => {
      document = nextDocument;
    },
    setPendingUpdates: (nextUpdates) => {
      pendingUpdates = nextUpdates;
    },
  });
  return {
    ...creationPersistence,
    supportsAtomicRecoveryHistoryPruning: true,
    async commitDocumentMutation(execSql, input, saveClientProjection) {
      return commitMemoryDocumentMutation({
        execSql,
        getState: () => ({
          document,
          localAttachments,
          pendingAttachments,
          pendingUpdates,
        }),
        historyByLocalId,
        mutation: input,
        replaceState: (nextState) => {
          document = nextState.document;
          localAttachments = nextState.localAttachments;
          pendingAttachments = nextState.pendingAttachments;
          pendingUpdates = nextState.pendingUpdates;
        },
        saveClientProjection,
      });
    },
    async settleAcceptedPendingUpdates(_execSql, input) {
      if (
        document?.documentId === input.expectedRecord.documentId &&
        document.accessEpoch === input.expectedRecord.accessEpoch &&
        memoryDocumentRecoveryGenerationMatches(document, input.expectedRecord)
      ) {
        const acceptedIds = new Set(input.pendingUpdateIds);
        pendingUpdates = pendingUpdates.filter(
          ({ id }) => !acceptedIds.has(id),
        );
      }
      return document;
    },
    async ensureSchema() {},
    async findDocumentLocalIdsByContainerId(_execSql, containerId) {
      return document?.containerId === containerId ? [document.id] : [];
    },
    async findLocalIdByDocumentId(_execSql, documentId) {
      return document?.documentId === documentId ? document.id : null;
    },
    async hasDocument(_execSql, localId) {
      return document?.id === localId;
    },
    async documentIdentityMatches(
      _execSql,
      localId,
      expectedDocumentId,
      expectedRecoveryGeneration,
    ) {
      return memoryDocumentWriteFenceMatches(
        document,
        localId,
        expectedDocumentId,
        expectedRecoveryGeneration,
      );
    },
    getState() {
      return {
        document,
        documentSummaries: buildMemoryDocumentSummaries(document),
        localAttachments,
        pendingAttachments,
        pendingUpdates,
      };
    },
    async listDocuments() {
      return buildMemoryDocumentSummaries(document);
    },
    async listDocumentSummaries() {
      const rows = buildMemoryDocumentSummaries(document);
      return {
        rows,
        totalCount: rows.length,
      };
    },
    async listDocumentsByContainerIdsOrDocumentIds(_execSql, input) {
      if (!document) {
        return [];
      }
      const containerIds = new Set(input.containerIds);
      const documentIds = new Set(input.documentIds);
      const containerMatches =
        document.containerId !== null && containerIds.has(document.containerId);
      const documentMatches =
        document.documentId !== null && documentIds.has(document.documentId);
      if (!containerMatches && !documentMatches) {
        return [];
      }
      return [
        {
          id: document.id,
          containerId: document.containerId,
          documentId: document.documentId,
          title: document.text.trim() || "Untitled note",
          updatedAt: "2026-04-06T00:00:00.000Z",
        },
      ];
    },
    async loadDocument() {
      return document;
    },
    async invalidatePullContinuation(_execSql, input) {
      document = invalidateMemoryDocumentPullContinuation(document, input);
      if (!document) return null;
      const history = historyByLocalId.get(input.localId);
      return {
        historyRestoreState: toHistoryRestoreState(history),
        record: document,
      };
    },
    async loadDocumentContainer(_execSql, localId) {
      return document?.id === localId
        ? { containerId: document.containerId }
        : undefined;
    },
    async saveDocument(_execSql, nextDocument) {
      if (canSaveMemoryDocument(document, nextDocument))
        document = nextDocument;
      return "2026-04-06T00:00:00.000Z";
    },
    async saveDocumentAndDeletePendingUpdates(
      _execSql,
      nextDocument,
      pendingUpdateIds,
    ) {
      if (!canSaveMemoryDocument(document, nextDocument)) {
        return "2026-04-06T00:00:00.000Z";
      }
      const acceptedPendingUpdateIds = new Set(pendingUpdateIds);
      document = nextDocument;
      pendingUpdates = pendingUpdates.filter(
        (pendingUpdate) => !acceptedPendingUpdateIds.has(pendingUpdate.id),
      );
      return "2026-04-06T00:00:00.000Z";
    },
    ...deletionPersistence,
    ...createMemoryAbsentDocumentCleanup({
      deleteSideRows,
      documentExists: (localId) => document?.id === localId,
    }),
    async appendHistoryUpdates(_execSql, input) {
      const history = historyFor(input.localId);
      history.tail = [
        ...history.tail,
        ...input.updates.map((updateData) => ({
          id: crypto.randomUUID(),
          origin: input.origin,
          updateData,
        })),
      ];
    },
    async loadHistoryRestoreState(_execSql, localId) {
      return toHistoryRestoreState(historyByLocalId.get(localId));
    },
    ...createMemoryDocumentStartupReads({
      getDocument: () => document,
      getLocalAttachments: () => localAttachments,
      getPendingAttachments: () => pendingAttachments,
      historyByLocalId,
    }),
    async readHistoryTailSize(_execSql, localId) {
      const history = historyFor(localId);
      return {
        byteLength: history.tail.reduce(
          (total, entry) => total + entry.updateData.length,
          0,
        ),
        hasCheckpoint: history.checkpoint !== null,
        rowCount: history.tail.length,
      };
    },
    async listHistoryTailEntries(_execSql, localId) {
      return historyFor(localId).tail.map((entry) => ({ ...entry }));
    },
    async replaceHistoryCheckpoint(_execSql, input) {
      if (input.stillCurrent && !input.stillCurrent()) {
        return;
      }
      const history = historyFor(input.localId);
      const coveredTailIds = new Set(input.coveredTailIds);
      history.checkpoint = {
        endVersionVector: input.endVersionVector,
        snapshot: input.snapshot,
      };
      history.tail = history.tail.filter(
        (entry) => !coveredTailIds.has(entry.id),
      );
    },
    async upsertDiscoveredDocument(_execSql, input) {
      const nextDocument = {
        accessEpoch: input.accessEpoch,
        containerId: input.containerId,
        documentId: input.documentId,
        id: document?.id ?? input.documentId,
        recoveryGeneration: document?.recoveryGeneration ?? 0,
        snapshotEndVersion: document?.snapshotEndVersion ?? "",
        text: document?.text ?? "",
      };
      document = nextDocument;
      return {
        id: nextDocument.id,
        containerId: nextDocument.containerId,
        documentId: nextDocument.documentId,
        title: nextDocument.text.trim() || "Untitled note",
        updatedAt: input.createdAt,
      };
    },
    async relinkPersistedDocument(_execSql, input) {
      if (!document || document.id !== input.localId) {
        return null;
      }
      document = {
        ...document,
        accessEpoch: Math.max(document.accessEpoch, input.accessEpoch),
        containerId: input.containerId,
        documentId: input.documentId,
      };

      return {
        id: document.id,
        containerId: document.containerId,
        documentId: document.documentId,
        title: document.text.trim() || "Untitled note",
        updatedAt: "2026-04-06T00:00:00.000Z",
      };
    },
    async listPendingUpdates() {
      return pendingUpdates;
    },
    async rekeyPendingUpdate(_execSql, id: string) {
      const pendingUpdate = pendingUpdates.find(
        (candidate) => candidate.id === id,
      );
      if (!pendingUpdate) {
        return null;
      }
      const nextId = crypto.randomUUID();
      pendingUpdates = pendingUpdates.map((candidate) =>
        candidate.id === id ? { ...candidate, id: nextId } : candidate,
      );
      return nextId;
    },
    async listPendingAttachments() {
      return pendingAttachments;
    },
    async listLocalAttachments() {
      return localAttachments;
    },
    async enqueuePendingUpdate(
      _execSql,
      pendingUpdate: PendingUpdateInsert,
      options,
    ) {
      const result = enqueueMemoryPendingUpdate({
        document,
        historyByLocalId,
        options,
        pendingUpdate,
        pendingUpdates,
      });
      pendingUpdates = result.pendingUpdates;
      return result.enqueued;
    },
    async deletePendingUpdate(_execSql, id: string) {
      pendingUpdates = pendingUpdates.filter(
        (pendingUpdate) => pendingUpdate.id !== id,
      );
    },
    async deletePendingUpdates() {
      pendingUpdates = [];
    },
    async deletePendingAttachment(_execSql, localId, slotId, storageKey) {
      pendingAttachments = pendingAttachments.filter(
        (attachment) =>
          !(
            attachment.localId === localId &&
            attachment.slotId === slotId &&
            attachment.storageKey === storageKey
          ),
      );
    },
    async saveLocalAttachment(_execSql, attachment) {
      localAttachments = [
        ...localAttachments.filter(
          (existingAttachment) =>
            !(
              existingAttachment.localId === attachment.localId &&
              existingAttachment.slotId === attachment.slotId
            ),
        ),
        attachment,
      ];
    },
    async deleteLocalAttachment(_execSql, localId, slotId, storageKey) {
      localAttachments = localAttachments.filter(
        (attachment) =>
          !(
            attachment.localId === localId &&
            attachment.slotId === slotId &&
            attachment.storageKey === storageKey
          ),
      );
    },
    async markLocalAttachmentDetached(_execSql, localId, slotId, storageKey) {
      localAttachments = localAttachments.map((attachment) =>
        attachment.localId === localId &&
        attachment.slotId === slotId &&
        attachment.storageKey === storageKey &&
        attachment.detachedAt === null
          ? { ...attachment, detachedAt: "2026-04-06T00:00:00.000Z" }
          : attachment,
      );
    },
    async savePendingAttachment(_execSql, attachment) {
      pendingAttachments = [
        ...pendingAttachments.filter(
          (existingAttachment) =>
            !(
              existingAttachment.localId === attachment.localId &&
              existingAttachment.slotId === attachment.slotId
            ),
        ),
        attachment,
      ];
    },
    async deletePendingAttachments(_execSql, localId) {
      pendingAttachments = pendingAttachments.filter(
        (attachment) => attachment.localId !== localId,
      );
    },
  };
}

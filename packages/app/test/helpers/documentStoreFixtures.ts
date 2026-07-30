import type { DocumentSummary, DocumentsRuntime } from "@tearleads/client-sdk";
import {
  createDocumentsWorkflowRuntime,
  createDomainScope,
  type DocumentRecord,
  type DocumentsPersistence,
  type LocalAttachmentRecord,
  type PendingAttachmentRecord,
  type PendingUpdateInsert,
  type PendingUpdateRecord,
} from "@tearleads/client-sdk";
import { createMockApiClient } from "@tearleads/test-utils";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../src/document-types/projectors";
import { createFixtureBlobStore } from "./documentStoreBlobStore";

interface StoredDocumentsState {
  document: DocumentRecord | null;
  localAttachments: LocalAttachmentRecord[];
  pendingAttachments: PendingAttachmentRecord[];
  pendingUpdates: PendingUpdateRecord[];
}

interface StoredHistoryState {
  checkpoint: { endVersionVector: string; snapshot: string } | null;
  tail: { id: string; origin: "local" | "remote"; updateData: string }[];
}

type HistoryByLocalId = Map<string, StoredHistoryState>;

type MutableDocumentsState = StoredDocumentsState;
type RuntimeInput = Parameters<typeof createDocumentsWorkflowRuntime>[0];
type RuntimeInputOverrides = {
  apiClient?: RuntimeInput["apiClient"];
  auth?: Partial<RuntimeInput["auth"]>;
  crypto?: Partial<RuntimeInput["crypto"]>;
  infra?: Partial<RuntimeInput["infra"]>;
  state?: Partial<RuntimeInput["state"]>;
  util?: Partial<RuntimeInput["util"]>;
};
function documentSummaryFromRecord(record: DocumentRecord): DocumentSummary {
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

function createDocumentReadPersistence(
  state: MutableDocumentsState,
): Pick<
  DocumentsPersistence,
  | "ensureSchema"
  | "findDocumentLocalIdsByContainerId"
  | "hasDocument"
  | "listDocumentSummaries"
  | "listDocuments"
  | "listDocumentsByContainerIdsOrDocumentIds"
  | "loadDocument"
  | "loadDocumentContainer"
> {
  return {
    async ensureSchema() {},
    async findDocumentLocalIdsByContainerId(_execSql, containerId) {
      return state.document?.containerId === containerId
        ? [state.document.id]
        : [];
    },
    async hasDocument(_execSql, localId) {
      return state.document?.id === localId;
    },
    async listDocuments() {
      return state.document ? [documentSummaryFromRecord(state.document)] : [];
    },
    async listDocumentSummaries() {
      const rows = state.document
        ? [documentSummaryFromRecord(state.document)]
        : [];
      return {
        rows,
        totalCount: rows.length,
      };
    },
    async listDocumentsByContainerIdsOrDocumentIds(_execSql, input) {
      if (!state.document) {
        return [];
      }

      const containerIds = new Set(input.containerIds);
      const documentIds = new Set(input.documentIds);
      const containerMatches =
        state.document.containerId !== null &&
        containerIds.has(state.document.containerId);
      const documentMatches =
        state.document.documentId !== null &&
        documentIds.has(state.document.documentId);

      return containerMatches || documentMatches
        ? [documentSummaryFromRecord(state.document)]
        : [];
    },
    async loadDocument(_execSql, localId) {
      return state.document?.id === localId ? state.document : null;
    },
    async loadDocumentContainer(_execSql, localId) {
      return state.document?.id === localId
        ? { containerId: state.document.containerId }
        : undefined;
    },
  };
}

function createDocumentWritePersistence(
  state: MutableDocumentsState,
  historyByLocalId: HistoryByLocalId,
): Pick<
  DocumentsPersistence,
  | "saveDocument"
  | "saveDocumentAndDeletePendingUpdates"
  | "deleteDocument"
  | "upsertDiscoveredDocument"
  | "relinkPersistedDocument"
> {
  return {
    async saveDocument(_execSql, nextDocument) {
      state.document = nextDocument;
      return "2026-04-06T00:00:00.000Z";
    },
    async saveDocumentAndDeletePendingUpdates(
      _execSql,
      nextDocument,
      pendingUpdateIds,
    ) {
      const acceptedPendingUpdateIds = new Set(pendingUpdateIds);
      state.document = nextDocument;
      state.pendingUpdates = state.pendingUpdates.filter(
        (pendingUpdate) => !acceptedPendingUpdateIds.has(pendingUpdate.id),
      );
      return "2026-04-06T00:00:00.000Z";
    },
    async deleteDocument(_execSql, localId) {
      if (state.document?.id === localId) {
        state.document = null;
      }
      historyByLocalId.delete(localId);
      state.pendingUpdates = [];
      state.pendingAttachments = state.pendingAttachments.filter(
        (attachment) => attachment.localId !== localId,
      );
      state.localAttachments = state.localAttachments.filter(
        (attachment) => attachment.localId !== localId,
      );
    },
    async upsertDiscoveredDocument(_execSql, input) {
      const nextDocument: DocumentRecord = {
        accessEpoch: input.accessEpoch,
        accessStateHash: input.accessStateHash ?? null,
        containerId: input.containerId,
        documentId: input.documentId,
        id: state.document?.id ?? input.documentId,
        lastCommitLsn: null,
        snapshotEndVersion: state.document?.snapshotEndVersion ?? "",
        text: state.document?.text ?? "",
      };
      state.document = nextDocument;
      return documentSummaryFromRecord(state.document);
    },
    async relinkPersistedDocument(_execSql, input) {
      if (!state.document || state.document.id !== input.localId) {
        return null;
      }

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

function createPendingUpdatePersistence(
  state: MutableDocumentsState,
  historyByLocalId: HistoryByLocalId,
): Pick<
  DocumentsPersistence,
  | "listPendingUpdates"
  | "rekeyPendingUpdate"
  | "enqueuePendingUpdate"
  | "deletePendingUpdate"
  | "deletePendingUpdates"
> {
  return {
    async listPendingUpdates() {
      return state.pendingUpdates;
    },
    async rekeyPendingUpdate(_execSql, id) {
      const pendingUpdate = state.pendingUpdates.find(
        (candidate) => candidate.id === id,
      );
      if (!pendingUpdate) {
        return null;
      }
      const nextId = crypto.randomUUID();
      state.pendingUpdates = state.pendingUpdates.map((candidate) =>
        candidate.id === id ? { ...candidate, id: nextId } : candidate,
      );
      return nextId;
    },
    async enqueuePendingUpdate(_execSql, pendingUpdate: PendingUpdateInsert) {
      state.pendingUpdates = [
        ...state.pendingUpdates,
        {
          id: crypto.randomUUID(),
          partialEndVersionVector: pendingUpdate.partialEndVersionVector,
          partialStartVersionVector: pendingUpdate.partialStartVersionVector,
          sourceVersionVector: pendingUpdate.sourceVersionVector ?? null,
          updateData: pendingUpdate.updateData,
        },
      ];
      // Mirror the SQL persistence: every enqueued update is dual-written to
      // the durable-history tail in the same transaction, so a restore
      // rebuilds queued-but-unsynced local edits from checkpoint + tail.
      let history = historyByLocalId.get(pendingUpdate.localId);
      if (!history) {
        history = { checkpoint: null, tail: [] };
        historyByLocalId.set(pendingUpdate.localId, history);
      }
      history.tail = [
        ...history.tail,
        {
          id: crypto.randomUUID(),
          origin: "local",
          updateData: pendingUpdate.updateData,
        },
      ];
    },
    async deletePendingUpdate(_execSql, id) {
      state.pendingUpdates = state.pendingUpdates.filter(
        (pendingUpdate) => pendingUpdate.id !== id,
      );
    },
    async deletePendingUpdates() {
      state.pendingUpdates = [];
    },
  };
}

function createAttachmentPersistence(
  state: MutableDocumentsState,
): Pick<
  DocumentsPersistence,
  | "listPendingAttachments"
  | "listLocalAttachments"
  | "saveLocalAttachment"
  | "deleteLocalAttachment"
  | "markLocalAttachmentDetached"
  | "savePendingAttachment"
  | "deletePendingAttachment"
  | "deletePendingAttachments"
> {
  return {
    async listPendingAttachments(_execSql, localId) {
      return state.pendingAttachments.filter(
        (attachment) => attachment.localId === localId,
      );
    },
    async listLocalAttachments(_execSql, localId) {
      return state.localAttachments.filter(
        (attachment) => attachment.localId === localId,
      );
    },
    async saveLocalAttachment(_execSql, attachment) {
      state.localAttachments = [
        ...state.localAttachments.filter(
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
      state.localAttachments = state.localAttachments.filter(
        (attachment) =>
          !(
            attachment.localId === localId &&
            attachment.slotId === slotId &&
            attachment.storageKey === storageKey
          ),
      );
    },
    async markLocalAttachmentDetached(_execSql, localId, slotId, storageKey) {
      state.localAttachments = state.localAttachments.map((attachment) =>
        attachment.localId === localId &&
        attachment.slotId === slotId &&
        attachment.storageKey === storageKey &&
        attachment.detachedAt === null
          ? { ...attachment, detachedAt: "2026-04-06T00:00:00.000Z" }
          : attachment,
      );
    },
    async savePendingAttachment(_execSql, attachment) {
      state.pendingAttachments = [
        ...state.pendingAttachments.filter(
          (existingAttachment) =>
            !(
              existingAttachment.localId === attachment.localId &&
              existingAttachment.slotId === attachment.slotId
            ),
        ),
        attachment,
      ];
    },
    async deletePendingAttachment(_execSql, localId, slotId, storageKey) {
      state.pendingAttachments = state.pendingAttachments.filter(
        (attachment) =>
          !(
            attachment.localId === localId &&
            attachment.slotId === slotId &&
            attachment.storageKey === storageKey
          ),
      );
    },
    async deletePendingAttachments(_execSql, localId) {
      state.pendingAttachments = state.pendingAttachments.filter(
        (attachment) => attachment.localId !== localId,
      );
    },
  };
}

function createHistoryPersistence(
  historyByLocalId: HistoryByLocalId,
): Pick<
  DocumentsPersistence,
  | "appendHistoryUpdates"
  | "loadHistoryRestoreState"
  | "readHistoryTailSize"
  | "listHistoryTailEntries"
  | "replaceHistoryCheckpoint"
> {
  const historyFor = (localId: string): StoredHistoryState => {
    let history = historyByLocalId.get(localId);
    if (!history) {
      history = { checkpoint: null, tail: [] };
      historyByLocalId.set(localId, history);
    }
    return history;
  };

  return {
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
      const history = historyByLocalId.get(localId);
      if (!history || (!history.checkpoint && history.tail.length === 0)) {
        return null;
      }
      // Mirror the SQL persistence: a tail without a checkpoint restores as
      // tail-only (empty snapshot) rather than being silently ignored.
      return {
        snapshot: history.checkpoint?.snapshot ?? "",
        tailUpdates: history.tail.map((entry) => ({
          origin: entry.origin,
          updateData: entry.updateData,
        })),
      };
    },
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
  };
}

export function createDocumentStorePersistence(): DocumentsPersistence & {
  getState: () => StoredDocumentsState;
} {
  const state: MutableDocumentsState = {
    document: null,
    localAttachments: [],
    pendingAttachments: [],
    pendingUpdates: [],
  };
  const historyByLocalId: HistoryByLocalId = new Map();

  return {
    getState: () => state,
    ...createDocumentReadPersistence(state),
    ...createDocumentWritePersistence(state, historyByLocalId),
    ...createPendingUpdatePersistence(state, historyByLocalId),
    ...createAttachmentPersistence(state),
    ...createHistoryPersistence(historyByLocalId),
  };
}

export function createDocumentStoreRuntime(
  overrides: RuntimeInputOverrides = {},
): DocumentsRuntime {
  return createDocumentsWorkflowRuntime({
    apiClient: overrides.apiClient ?? createMockApiClient(),
    auth: {
      isAuthenticated: false,
      organizationId: null,
      userId: null,
      ...overrides.auth,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
      ...overrides.crypto,
    },
    infra: {
      blobStore: createFixtureBlobStore(),
      dbStatus: "ready",
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      execSql: async () => [],
      ...overrides.infra,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: "root-container",
      domainScope: createDomainScope(),
      events: [],
      online: false,
      ...overrides.state,
    },
    util: {
      log: () => {},
      ...overrides.util,
    },
  });
}

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
import { APP_DOCUMENT_PROJECTOR_REGISTRY } from "../../src/document-types/projectors";

interface StoredDocumentsState {
  document: DocumentRecord | null;
  localAttachments: LocalAttachmentRecord[];
  pendingAttachments: PendingAttachmentRecord[];
  pendingUpdates: PendingUpdateRecord[];
}

type MutableDocumentsState = StoredDocumentsState;
type RuntimeInput = Parameters<typeof createDocumentsWorkflowRuntime>[0];
type FixtureBlobBytes = Parameters<RuntimeInput["blobStore"]["writeBytes"]>[1];

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

function createFixtureBlobStore(): RuntimeInput["blobStore"] {
  const blobs = new Map<string, FixtureBlobBytes>();

  return {
    async deleteBytes(storageKey) {
      blobs.delete(storageKey);
    },
    async readBytes(storageKey) {
      return blobs.get(storageKey) ?? null;
    },
    async writeBytes(storageKey, bytes) {
      blobs.set(storageKey, bytes);
    },
  };
}

function createDocumentReadPersistence(
  state: MutableDocumentsState,
): Pick<
  DocumentsPersistence,
  | "ensureSchema"
  | "listDocuments"
  | "listDocumentsByContainerIdsOrDocumentIds"
  | "loadDocument"
> {
  return {
    async ensureSchema() {},
    async listDocuments() {
      return state.document ? [documentSummaryFromRecord(state.document)] : [];
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
  };
}

function createDocumentWritePersistence(
  state: MutableDocumentsState,
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
        loroSnapshot: state.document?.loroSnapshot ?? "",
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
): Pick<
  DocumentsPersistence,
  | "listPendingUpdates"
  | "enqueuePendingUpdate"
  | "deletePendingUpdate"
  | "deletePendingUpdates"
> {
  return {
    async listPendingUpdates() {
      return state.pendingUpdates;
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

export function createDocumentStorePersistence(): DocumentsPersistence & {
  getState: () => StoredDocumentsState;
} {
  const state: MutableDocumentsState = {
    document: null,
    localAttachments: [],
    pendingAttachments: [],
    pendingUpdates: [],
  };

  return {
    getState: () => state,
    ...createDocumentReadPersistence(state),
    ...createDocumentWritePersistence(state),
    ...createPendingUpdatePersistence(state),
    ...createAttachmentPersistence(state),
  };
}

export function createDocumentStoreRuntime(
  overrides: Partial<RuntimeInput> = {},
): DocumentsRuntime {
  return createDocumentsWorkflowRuntime({
    apiClient: createMockApiClient(),
    blobStore: createFixtureBlobStore(),
    cacheReferencedPrincipalPolicies: async () => {},
    containerId: "root-container",
    dbStatus: "ready",
    documentProjectors: APP_DOCUMENT_PROJECTOR_REGISTRY,
    domainScope: createDomainScope(),
    encapsulationKeyPair: null,
    events: [],
    execSql: async () => [],
    isAuthenticated: false,
    log: () => {},
    online: false,
    ...overrides,
  });
}

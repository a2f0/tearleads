import type {
  DocumentRecord,
  DocumentSummary,
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingUpdateInsert,
  PendingUpdateRecord,
} from "@tearleads/client-sdk";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type {
  PendingUpdateLengthRow,
  ProjectionLengthRow,
  StoredDocumentsState,
} from "./documentStoreSyncFixtures";

interface PendingUpdateDetailRow extends PendingUpdateLengthRow {
  partial_start_version_vector: string | null;
  partial_end_version_vector: string | null;
}

export function readRowValue(value: unknown, key: string): unknown {
  return isPlainObject(value) ? value[key] : undefined;
}

export function isPendingUpdateLengthRow(
  value: unknown,
): value is PendingUpdateLengthRow {
  const updateDataLength = readRowValue(value, "update_data_length");
  return (
    typeof updateDataLength === "number" ||
    typeof updateDataLength === "string" ||
    updateDataLength === null
  );
}

export function isProjectionLengthRow(
  value: unknown,
): value is ProjectionLengthRow {
  const textLength = readRowValue(value, "text_length");
  return (
    typeof textLength === "number" ||
    typeof textLength === "string" ||
    textLength === null
  );
}

export function isPendingUpdateDetailRow(
  value: unknown,
): value is PendingUpdateDetailRow {
  const partialStartVersionVector = readRowValue(
    value,
    "partial_start_version_vector",
  );
  const partialEndVersionVector = readRowValue(
    value,
    "partial_end_version_vector",
  );

  return (
    isPendingUpdateLengthRow(value) &&
    (typeof partialStartVersionVector === "string" ||
      partialStartVersionVector === null) &&
    (typeof partialEndVersionVector === "string" ||
      partialEndVersionVector === null)
  );
}

export function createDocumentsPersistence(): DocumentsPersistence & {
  getState: () => StoredDocumentsState;
} {
  let document: DocumentRecord | null = null;
  let localAttachments: LocalAttachmentRecord[] = [];
  let pendingAttachments: PendingAttachmentRecord[] = [];
  let pendingUpdates: PendingUpdateRecord[] = [];

  const buildDocumentSummaries = (): DocumentSummary[] =>
    document
      ? [
          {
            id: document.id,
            containerId: document.containerId,
            documentId: document.documentId,
            title: document.text.trim() || "Untitled note",
            updatedAt: "2026-04-06T00:00:00.000Z",
          },
        ]
      : [];

  return {
    async ensureSchema() {},
    async findDocumentLocalIdsByContainerId(_execSql, containerId) {
      return document?.containerId === containerId ? [document.id] : [];
    },
    getState() {
      return {
        document,
        documentSummaries: buildDocumentSummaries(),
        localAttachments,
        pendingAttachments,
        pendingUpdates,
      };
    },
    async listDocuments() {
      return buildDocumentSummaries();
    },
    async listDocumentSummaries() {
      const rows = buildDocumentSummaries();
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
    async loadDocumentContainer(_execSql, localId) {
      return document?.id === localId
        ? { containerId: document.containerId }
        : undefined;
    },
    async saveDocument(_execSql, nextDocument) {
      document = nextDocument;
      return "2026-04-06T00:00:00.000Z";
    },
    async saveDocumentAndDeletePendingUpdates(
      _execSql,
      nextDocument,
      pendingUpdateIds,
    ) {
      const acceptedPendingUpdateIds = new Set(pendingUpdateIds);
      document = nextDocument;
      pendingUpdates = pendingUpdates.filter(
        (pendingUpdate) => !acceptedPendingUpdateIds.has(pendingUpdate.id),
      );
      return "2026-04-06T00:00:00.000Z";
    },
    async deleteDocument(_execSql, localId) {
      if (document?.id === localId) {
        document = null;
      }
      pendingUpdates = [];
      pendingAttachments = pendingAttachments.filter(
        (attachment) => attachment.localId !== localId,
      );
      localAttachments = localAttachments.filter(
        (attachment) => attachment.localId !== localId,
      );
    },
    async upsertDiscoveredDocument(_execSql, input) {
      const nextDocument = {
        accessEpoch: input.accessEpoch,
        containerId: input.containerId,
        documentId: input.documentId,
        id: document?.id ?? input.documentId,
        loroSnapshot: document?.loroSnapshot ?? "",
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
    async enqueuePendingUpdate(_execSql, pendingUpdate: PendingUpdateInsert) {
      pendingUpdates = [
        ...pendingUpdates,
        {
          id: crypto.randomUUID(),
          partialEndVersionVector: pendingUpdate.partialEndVersionVector,
          partialStartVersionVector: pendingUpdate.partialStartVersionVector,
          sourceVersionVector: pendingUpdate.sourceVersionVector ?? null,
          updateData: pendingUpdate.updateData,
        },
      ];
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

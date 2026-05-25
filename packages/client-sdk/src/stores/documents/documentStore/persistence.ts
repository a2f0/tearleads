import { getTextValue } from "@tearleads/loro";
import type { DocumentSummary } from "../../../data/documentSummary";
import { DEFAULT_DOCUMENT_KIND } from "../../../data/documents/documentConstants";
import {
  type DocumentAttachment,
  getDocumentAttachments,
} from "../../../data/documents/documentContent";
import {
  type DocumentProjectorRegistry,
  projectStoredDocumentState,
} from "../../../data/documents/documentKinds";
import { hydrateDocumentAttachmentBlobs } from "../../../workflows/blobs";
import {
  type DocumentRecord,
  deletePendingDocumentAttachment,
  enqueuePendingDocumentUpdate,
  type LocalAttachmentRecord,
  listPendingDocumentUpdates,
  type PendingAttachmentRecord,
  type PendingUpdateRecord,
  persistDocumentState,
  saveLocalDocumentAttachments,
  savePendingDocumentAttachment,
} from "../../../workflows/documents";
import {
  type DocumentState,
  type DocumentStoreState,
  type PersistedDocumentRecord,
  type SaveDocumentRecordOptions,
  setReadySnapshot,
} from "./state";

function documentSummaryFromRecord(
  record: DocumentRecord,
  updatedAt: string,
  documentProjectors: DocumentProjectorRegistry,
): DocumentSummary {
  return {
    accessStateHash: record.accessStateHash ?? null,
    id: record.id,
    containerId: record.containerId,
    documentKind: record.documentKind ?? DEFAULT_DOCUMENT_KIND,
    documentId: record.documentId,
    title:
      record.title ??
      projectStoredDocumentState(
        {
          documentKind: record.documentKind ?? DEFAULT_DOCUMENT_KIND,
          structuredFields: {},
          text: record.text,
        },
        documentProjectors,
      ).title,
    updatedAt,
  };
}

export async function saveDocumentRecord(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  patch: Partial<DocumentRecord> = {},
  options: SaveDocumentRecordOptions = {},
): Promise<PersistedDocumentRecord> {
  const previousDocumentId = state.record?.documentId ?? null;
  const persistedDocumentState = await persistDocumentState({
    acceptedPendingUpdateIds: options.acceptedPendingUpdateIds,
    containerId: state.runtime.state.containerId,
    currentDoc,
    currentRecord: state.record,
    documentProjectors: state.runtime.infra.documentProjectors,
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    patch,
    persistence: state.persistence,
  });
  const { record: nextRecord, updatedAt } = persistedDocumentState;
  state.record = persistedDocumentState.record;
  if (previousDocumentId !== nextRecord.documentId) {
    state.effects.registerDocumentIdentity(
      state.runtime.state.domainScope,
      nextRecord.id,
      nextRecord.documentId,
    );
  }
  state.effects.emitPersistedDocument(
    state.runtime.state.domainScope,
    documentSummaryFromRecord(
      nextRecord,
      updatedAt,
      state.runtime.infra.documentProjectors,
    ),
  );
  return {
    record: nextRecord,
    updatedAt,
  };
}

export async function persistDocument(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  patch: Partial<DocumentRecord> = {},
  options: SaveDocumentRecordOptions = {},
): Promise<PersistedDocumentRecord> {
  const persistedRecord = await saveDocumentRecord(
    state,
    currentDoc,
    patch,
    options,
  );
  setReadySnapshot(
    state,
    currentDoc,
    state.snapshot.syncing,
    persistedRecord.record.text,
  );
  return persistedRecord;
}

export async function listPendingUpdates(
  state: DocumentStoreState,
): Promise<PendingUpdateRecord[]> {
  return listPendingDocumentUpdates({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
  });
}

export async function enqueuePendingUpdate(
  state: DocumentStoreState,
  update: Uint8Array,
  sourceVersionVector?: string | null,
) {
  await enqueuePendingDocumentUpdate({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
    ...(sourceVersionVector === undefined ? {} : { sourceVersionVector }),
    update,
  });
}

export async function deletePendingAttachment(
  state: DocumentStoreState,
  slotId: string,
  storageKey: string,
) {
  await deletePendingDocumentAttachment({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
    slotId,
    storageKey,
  });
}

export async function saveLocalAttachmentRecord(
  state: DocumentStoreState,
  attachment: LocalAttachmentRecord,
  currentDoc: DocumentState | null = state.doc,
) {
  await saveLocalAttachmentRecords(state, [attachment], currentDoc);
}

async function saveLocalAttachmentRecords(
  state: DocumentStoreState,
  attachments: ReadonlyArray<LocalAttachmentRecord>,
  currentDoc: DocumentState | null = state.doc,
) {
  if (attachments.length === 0) {
    return;
  }

  await saveLocalDocumentAttachments({
    attachments,
    execSql: state.runtime.infra.execSql,
    persistence: state.persistence,
  });

  state.attachmentStorageKeyBySlotId = {
    ...state.attachmentStorageKeyBySlotId,
    ...Object.fromEntries(
      attachments.map((attachment) => [
        attachment.slotId,
        attachment.storageKey,
      ]),
    ),
  };

  if (currentDoc) {
    setReadySnapshot(
      state,
      currentDoc,
      state.snapshot.syncing,
      currentDoc === state.doc ? state.snapshot.text : getTextValue(currentDoc),
    );
  }
}

function listAttachmentsMissingLocalBytes(
  state: DocumentStoreState,
  currentDoc: DocumentState,
): DocumentAttachment[] {
  return getDocumentAttachments(currentDoc).filter(
    (attachment) => !state.attachmentStorageKeyBySlotId[attachment.slotId],
  );
}

export async function hydrateAttachmentBlobs(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord | null,
) {
  const encapsulationKeyPair = state.runtime.crypto.encapsulationKeyPair;
  if (
    !encapsulationKeyPair ||
    !state.runtime.auth.isAuthenticated ||
    !state.runtime.state.online ||
    !currentRecord?.documentId
  ) {
    return;
  }

  const attachmentsMissingLocalBytes = listAttachmentsMissingLocalBytes(
    state,
    currentDoc,
  );
  if (attachmentsMissingLocalBytes.length === 0) {
    return;
  }

  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: state.runtime.apiClient,
    attachments: attachmentsMissingLocalBytes,
    documentId: currentRecord.documentId,
    execSql: state.runtime.infra.execSql,
    log: state.runtime.util.log,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!hydratedBlobs) {
    return;
  }

  const localAttachmentRecords: LocalAttachmentRecord[] = [];
  for (const hydratedBlob of hydratedBlobs) {
    await state.runtime.infra.blobStore.writeBytes(
      hydratedBlob.storageKey,
      hydratedBlob.bytes,
    );
    localAttachmentRecords.push({
      blobId: hydratedBlob.binding.blobId,
      byteLength: hydratedBlob.attachment.byteLength,
      localId: state.localId,
      mimeType: hydratedBlob.attachment.mimeType,
      slotId: hydratedBlob.attachment.slotId,
      storageKey: hydratedBlob.storageKey,
    });
  }

  await saveLocalAttachmentRecords(state, localAttachmentRecords, currentDoc);
}

export function upsertPendingAttachments(
  state: DocumentStoreState,
  nextPendingAttachments: ReadonlyArray<PendingAttachmentRecord>,
) {
  const nextSlotIds = new Set(
    nextPendingAttachments.map((pendingAttachment) => pendingAttachment.slotId),
  );
  state.pendingAttachments = [
    ...state.pendingAttachments.filter(
      (pendingAttachment) => !nextSlotIds.has(pendingAttachment.slotId),
    ),
    ...nextPendingAttachments,
  ];
}

export async function queuePendingAttachmentUpload(
  state: DocumentStoreState,
  attachment: DocumentAttachment,
  storageKey: string,
): Promise<PendingAttachmentRecord> {
  const pendingAttachment: PendingAttachmentRecord = {
    byteLength: attachment.byteLength,
    localId: state.localId,
    mimeType: attachment.mimeType,
    name: attachment.name,
    slotId: attachment.slotId,
    storageKey,
  };
  await savePendingDocumentAttachment({
    attachment: pendingAttachment,
    execSql: state.runtime.infra.execSql,
    persistence: state.persistence,
  });
  upsertPendingAttachments(state, [pendingAttachment]);
  return pendingAttachment;
}

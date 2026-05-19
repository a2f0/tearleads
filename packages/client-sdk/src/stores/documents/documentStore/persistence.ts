import { getTextValue } from "@tearleads/loro";
import type { DocumentSummary } from "../../../data/documentSummary";
import {
  type DocumentAttachment,
  getDocumentAttachments,
} from "../../../data/documents/documentContent";
import {
  type DocumentProjectorRegistry,
  projectStoredDocumentState,
} from "../../../data/documents/documentKinds";
import type {
  DocumentRecord,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingUpdateRecord,
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
    documentKind: record.documentKind ?? "note",
    documentId: record.documentId,
    title:
      record.title ??
      projectStoredDocumentState(
        {
          documentKind: record.documentKind ?? "note",
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
  const persistedDocumentState = await state.runtime.persistState({
    acceptedPendingUpdateIds: options.acceptedPendingUpdateIds,
    containerId: state.runtime.containerId,
    currentDoc,
    currentRecord: state.record,
    localId: state.localId,
    patch,
    persistence: state.persistence,
  });
  const { record: nextRecord, updatedAt } = persistedDocumentState;
  state.record = persistedDocumentState.record;
  if (previousDocumentId !== nextRecord.documentId) {
    state.effects.registerDocumentIdentity(
      state.runtime.domainScope,
      nextRecord.id,
      nextRecord.documentId,
    );
  }
  state.effects.emitPersistedDocument(
    state.runtime.domainScope,
    documentSummaryFromRecord(
      nextRecord,
      updatedAt,
      state.runtime.documentProjectors,
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
  return state.runtime.listPendingUpdates({
    localId: state.localId,
    persistence: state.persistence,
  });
}

export async function enqueuePendingUpdate(
  state: DocumentStoreState,
  update: Uint8Array,
  sourceVersionVector?: string | null,
) {
  await state.runtime.enqueuePendingUpdate({
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
  await state.runtime.deletePendingAttachment({
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

  await state.runtime.saveLocalAttachments({
    attachments,
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
  const encapsulationKeyPair = state.runtime.encapsulationKeyPair;
  if (
    !encapsulationKeyPair ||
    !state.runtime.isAuthenticated ||
    !state.runtime.online ||
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

  const hydratedBlobs = await state.runtime.hydrateAttachmentBlobs({
    attachments: attachmentsMissingLocalBytes,
    documentId: currentRecord.documentId,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!hydratedBlobs) {
    return;
  }

  const localAttachmentRecords: LocalAttachmentRecord[] = [];
  for (const hydratedBlob of hydratedBlobs) {
    await state.runtime.writeBlobBytes(
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
  await state.runtime.savePendingAttachment({
    attachment: pendingAttachment,
    persistence: state.persistence,
  });
  upsertPendingAttachments(state, [pendingAttachment]);
  return pendingAttachment;
}

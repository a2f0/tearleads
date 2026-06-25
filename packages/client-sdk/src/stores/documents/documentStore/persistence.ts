import {
  encodeVersionVector,
  exportUpdatesSince,
  getTextValue,
} from "@tearleads/loro";
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
  deleteLocalDocumentAttachment,
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
    options.preserveSnapshotText
      ? state.snapshot.text
      : persistedRecord.record.text,
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

/**
 * Export the outgoing delta for the current edit. The base is `pendingBaseVersion`
 * (the version through which ops are already durably enqueued or synced), NOT the
 * live doc version, so any delta orphaned by a prior failed enqueue is folded back
 * in here. In the success path the marker equals the pre-edit version, so this is
 * identical to exporting "since the last edit".
 *
 * Initialization sets `pendingBaseVersion` whenever it sets `doc`, and every
 * caller checks `doc` first, so the marker is non-null here. Assert that rather
 * than falling back to the live version: callers invoke this AFTER mutating the
 * doc, so a live-version fallback would export an empty (post-mutation) delta and
 * silently drop the edit.
 */
export function pendingDeltaSinceBase(
  state: DocumentStoreState,
  doc: DocumentState,
): Uint8Array {
  if (state.pendingBaseVersion === null) {
    throw new Error(
      "pendingDeltaSinceBase requires an initialized pendingBaseVersion",
    );
  }
  return exportUpdatesSince(doc, state.pendingBaseVersion);
}

/**
 * Advance the durable marker to the doc's current version. Call this ONLY after
 * an edit's delta has been durably enqueued and persisted, or after remote
 * updates have been imported (those ops are already on the server).
 */
export function advancePendingBaseVersion(
  state: DocumentStoreState,
  doc: DocumentState,
): void {
  state.pendingBaseVersion = encodeVersionVector(doc);
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

export async function deleteLocalAttachmentRecord(
  state: DocumentStoreState,
  slotId: string,
  storageKey: string,
  currentDoc: DocumentState | null = state.doc,
) {
  await deleteLocalDocumentAttachment({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
    slotId,
    storageKey,
  });

  if (state.attachmentStorageKeyBySlotId[slotId] === storageKey) {
    const { [slotId]: _removedStorageKey, ...nextStorageKeys } =
      state.attachmentStorageKeyBySlotId;
    const { [slotId]: _removedBlobId, ...nextBlobIds } =
      state.attachmentBlobIdBySlotId;
    state.attachmentStorageKeyBySlotId = nextStorageKeys;
    state.attachmentBlobIdBySlotId = nextBlobIds;
  }

  if (currentDoc) {
    setReadySnapshot(
      state,
      currentDoc,
      state.snapshot.syncing,
      currentDoc === state.doc ? state.snapshot.text : getTextValue(currentDoc),
    );
  }
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

  state.attachmentBlobIdBySlotId = {
    ...state.attachmentBlobIdBySlotId,
    ...Object.fromEntries(
      attachments.map((attachment) => [attachment.slotId, attachment.blobId]),
    ),
  };
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

  const attachments = getDocumentAttachments(currentDoc);
  if (attachments.length === 0) {
    return;
  }

  const hydratedBlobs = await hydrateDocumentAttachmentBlobs({
    apiClient: state.runtime.apiClient,
    attachments,
    documentId: currentRecord.documentId,
    execSql: state.runtime.infra.execSql,
    localBlobIdBySlotId: state.attachmentBlobIdBySlotId,
    localStorageKeyBySlotId: state.attachmentStorageKeyBySlotId,
    log: state.runtime.util.log,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!hydratedBlobs) {
    return;
  }

  const localAttachmentRecords: LocalAttachmentRecord[] = [];
  const replacedStorageKeys: string[] = [];
  for (const hydratedBlob of hydratedBlobs) {
    const previousStorageKey =
      state.attachmentStorageKeyBySlotId[hydratedBlob.attachment.slotId];
    await state.runtime.infra.blobStore.writeBytes(
      hydratedBlob.storageKey,
      hydratedBlob.bytes,
    );
    if (previousStorageKey && previousStorageKey !== hydratedBlob.storageKey) {
      replacedStorageKeys.push(previousStorageKey);
    }
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
  await Promise.allSettled(
    replacedStorageKeys.map((storageKey) =>
      state.runtime.infra.blobStore.deleteBytes(storageKey),
    ),
  );
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

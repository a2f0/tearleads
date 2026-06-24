import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  importUpdates,
} from "@tearleads/loro";
import { getScopedPeerSeed } from "../../../data/crdtPeerSeed";
import type { DocumentSummary } from "../../../data/documentSummary";
import {
  DEFAULT_DOCUMENT_ACCESS_EPOCH,
  DEFAULT_DOCUMENT_KIND,
} from "../../../data/documents/documentConstants";
import { ensureDocumentAttachmentStructure } from "../../../data/documents/documentContent";
import {
  initializeStoredDocumentKind,
  projectStoredDocumentState,
  readStoredDocumentState,
} from "../../../data/documents/documentKinds";
import {
  DOCUMENTS_APP_KIND,
  type DocumentRecord,
  isDestroyedDatabaseClientError,
  loadPersistedDocumentStoreState,
} from "../../../workflows/documents";
import { requestDocumentStoreSync } from "../registry";
import type { DocumentStoreRelinkInput } from "../types";
import {
  advancePendingBaseVersion,
  enqueuePendingUpdate,
  persistDocument,
  saveDocumentRecord,
} from "./persistence";
import { type DocumentStoreState, setReadySnapshot } from "./state";

async function createStoredDocument() {
  const createdDoc = await createDocument(
    getScopedPeerSeed(DOCUMENTS_APP_KIND),
  );
  ensureDocumentAttachmentStructure(createdDoc);
  return createdDoc;
}

async function initializeDocumentStore(
  state: DocumentStoreState,
  scheduleSync: () => void,
) {
  if (state.runtime.infra.dbStatus !== "ready") {
    return;
  }

  const nextDoc = await createStoredDocument();
  const persistedState = await loadPersistedDocumentStoreState({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
  });
  state.pendingAttachments = persistedState.pendingAttachments;
  state.attachmentBlobIdBySlotId = Object.fromEntries(
    persistedState.localAttachments.map((attachment) => [
      attachment.slotId,
      attachment.blobId,
    ]),
  );
  state.attachmentStorageKeyBySlotId = Object.fromEntries(
    persistedState.localAttachments.map((attachment) => [
      attachment.slotId,
      attachment.storageKey,
    ]),
  );

  const existing = persistedState.document;
  if (existing) {
    if (existing.loroSnapshot.length > 0) {
      importUpdates(nextDoc, [base64ToBytes(existing.loroSnapshot)]);
    }

    state.record = existing;
    setReadySnapshot(state, nextDoc, false);
  } else {
    initializeStoredDocumentKind(
      nextDoc,
      state.initialDocumentKind,
      state.runtime.infra.documentProjectors,
    );
    if (state.initialText.length > 0) {
      nextDoc.getText("text").update(state.initialText);
    }
    const initialDocumentState = readStoredDocumentState(
      nextDoc,
      state.runtime.infra.documentProjectors,
    );

    const created: DocumentRecord = {
      id: state.localId,
      containerId: state.runtime.state.containerId ?? null,
      documentId: state.initialDocumentId,
      documentKind: initialDocumentState.documentKind,
      text: initialDocumentState.text,
      title: initialDocumentState.title,
      loroSnapshot: bytesToBase64(exportAllUpdates(nextDoc)),
      accessEpoch: DEFAULT_DOCUMENT_ACCESS_EPOCH,
      accessStateHash: null,
      lastCommitLsn: null,
      contentKeyBundle: null,
      documentKekTargets: null,
      documentManifestBundle: null,
    };
    await saveDocumentRecord(state, nextDoc, created);
    if (
      state.initialText.length > 0 ||
      state.initialDocumentKind !== DEFAULT_DOCUMENT_KIND
    ) {
      await enqueuePendingUpdate(state, exportAllUpdates(nextDoc));
    }
    setReadySnapshot(state, nextDoc, false);
  }

  state.doc = nextDoc;
  // Seed the durable marker to the loaded doc version: every op in the snapshot
  // is either already synced or sitting in the persisted pending queue.
  advancePendingBaseVersion(state, nextDoc);
  state.initialized = true;
  state.initializePromise = null;
  scheduleSync();
}

export function ensureDocumentStoreInitialized(
  state: DocumentStoreState,
  scheduleSync: () => void,
) {
  if (
    state.initialized ||
    state.initializePromise ||
    state.runtime.infra.dbStatus !== "ready"
  ) {
    return;
  }

  const initializePromise = initializeDocumentStore(state, scheduleSync).catch(
    (error: unknown) => {
      state.initializePromise = null;

      if (isDestroyedDatabaseClientError(error)) {
        return;
      }

      throw error;
    },
  );
  state.initializePromise = initializePromise;
  void initializePromise.catch(() => undefined);
}

export async function awaitInitializationForSync(state: DocumentStoreState) {
  if (!state.initializePromise) {
    return true;
  }

  try {
    await state.initializePromise;
    return true;
  } catch (error) {
    if (isDestroyedDatabaseClientError(error)) {
      return false;
    }

    throw error;
  }
}

export async function ensureDocumentStoreReady(
  state: DocumentStoreState,
  scheduleSync: () => void,
): Promise<boolean> {
  ensureDocumentStoreInitialized(state, scheduleSync);

  if (state.initialized) {
    return true;
  }

  if (!state.initializePromise) {
    return false;
  }

  return awaitInitializationForSync(state);
}

export async function relinkDocumentStore(
  state: DocumentStoreState,
  input: DocumentStoreRelinkInput,
  scheduleSync: () => void,
): Promise<DocumentSummary | null> {
  if (!(await ensureDocumentStoreReady(state, scheduleSync)) || !state.doc) {
    return null;
  }

  const currentAccessEpoch =
    state.record?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH;
  const patch: Partial<DocumentRecord> = {
    accessEpoch: Math.max(currentAccessEpoch, input.accessEpoch),
    accessStateHash:
      input.accessStateHash === undefined
        ? (state.record?.accessStateHash ?? null)
        : input.accessStateHash,
    containerId: input.containerId,
    documentId: input.documentId,
  };
  if (input.contentKeyBundle !== undefined) {
    patch.contentKeyBundle = input.contentKeyBundle;
  }
  if (input.documentKekTargets !== undefined) {
    patch.documentKekTargets = input.documentKekTargets;
  }
  if (input.documentManifestBundle !== undefined) {
    patch.documentManifestBundle = input.documentManifestBundle;
  }

  const { record: nextRecord, updatedAt } = await persistDocument(
    state,
    state.doc,
    patch,
  );
  if (input.queueBaselineAfterRelink) {
    await enqueuePendingUpdate(
      state,
      exportAllUpdates(state.doc),
      encodeVersionVector(state.doc),
    );
    advancePendingBaseVersion(state, state.doc);
    requestDocumentStoreSync(state);
  }
  return {
    accessStateHash: nextRecord.accessStateHash ?? null,
    id: nextRecord.id,
    containerId: nextRecord.containerId,
    documentKind: nextRecord.documentKind ?? DEFAULT_DOCUMENT_KIND,
    documentId: nextRecord.documentId,
    title:
      nextRecord.title ??
      projectStoredDocumentState(
        {
          documentKind: nextRecord.documentKind ?? DEFAULT_DOCUMENT_KIND,
          structuredFields: {},
          text: nextRecord.text,
        },
        state.runtime.infra.documentProjectors,
      ).title,
    updatedAt,
  };
}

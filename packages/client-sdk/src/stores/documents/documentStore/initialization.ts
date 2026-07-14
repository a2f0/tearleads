import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  exportAllUpdates,
  exportShallowSnapshot,
  importSnapshot,
} from "@tearleads/loro";
import { normalizeEffectiveAccessLevel } from "../../../data/accessLevel";
import { getScopedPeerSeed } from "../../../data/crdtPeerSeed";
import type { DocumentSummary } from "../../../data/documentSummary";
import {
  DEFAULT_DOCUMENT_ACCESS_EPOCH,
  DEFAULT_DOCUMENT_KIND,
} from "../../../data/documents/documentConstants";
import {
  addDocumentAttachments,
  type DocumentAttachment,
  ensureDocumentAttachmentStructure,
  getDocumentAttachments,
} from "../../../data/documents/documentContent";
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
import type { DocumentStoreRelinkInput } from "../types";
import {
  advancePendingBaseVersion,
  enqueuePendingUpdate,
  pendingDeltaSinceBase,
  persistDocument,
  saveDocumentRecord,
} from "./persistence";
import {
  type DocumentState,
  type DocumentStoreState,
  setReadySnapshot,
} from "./state";

export async function createStoredDocument(
  state: DocumentStoreState,
): Promise<DocumentState> {
  // Scope the peer seed per pane so two panes editing the same document derive
  // distinct Loro peer ids (sharing one would corrupt the CRDT). A null
  // peerScope (single-pane) keeps the bare scope, so the device-stable peer is
  // unchanged for the common case.
  const peerScope = state.runtime.state.peerScope;
  const scope = peerScope
    ? `${DOCUMENTS_APP_KIND}:${peerScope}`
    : DOCUMENTS_APP_KIND;
  const createdDoc = await createDocument(await getScopedPeerSeed(scope));
  ensureDocumentAttachmentStructure(createdDoc);
  return createdDoc;
}

// Re-derive any attachment slot that lives in a durable pending-upload row but
// is missing (or stale) in the loaded snapshot. The attach write path persists
// the blob bytes + pending-attachment row BEFORE it enqueues the slot's CRDT op
// and persists the snapshot, so a crash in that window leaves bytes+row durable
// but the slot gone from the document — the attachment would otherwise silently
// disappear on restart while its bytes upload to a binding nothing references
// (and a slot replace would keep stale metadata). Because the pending row still
// carries the slot's name/byteLength/mimeType and the bytes are on disk, we can
// rebuild the slot exactly and let the normal sync upload it. Runs on init only;
// a no-op when every pending attachment already matches a slot.
async function recoverDroppedAttachmentSlots(
  state: DocumentStoreState,
  doc: DocumentStoreState["doc"],
): Promise<void> {
  if (!doc || state.pendingAttachments.length === 0) {
    return;
  }

  const existingBySlotId = new Map(
    getDocumentAttachments(doc).map((attachment) => [
      attachment.slotId,
      attachment,
    ]),
  );
  const recovered: DocumentAttachment[] = [];
  for (const pending of state.pendingAttachments) {
    const mimeType = pending.mimeType ?? null;
    const existing = existingBySlotId.get(pending.slotId);
    if (
      existing &&
      existing.name === pending.name &&
      existing.byteLength === pending.byteLength &&
      existing.mimeType === mimeType
    ) {
      continue;
    }
    recovered.push({
      byteLength: pending.byteLength,
      mimeType,
      name: pending.name,
      slotId: pending.slotId,
    });
  }
  if (recovered.length === 0) {
    return;
  }

  addDocumentAttachments(doc, recovered);
  const update = pendingDeltaSinceBase(state, doc);
  if (update.byteLength > 0) {
    await enqueuePendingUpdate(state, update);
  }
  // Derive the snapshot from the loaded doc (do NOT preserve the snapshot). This
  // runs during init, before the store is ready, so state.snapshot is still the
  // empty initial snapshot — preserving it would publish a ready snapshot with
  // empty text/structured fields (a flash of empty content) over the real loaded
  // content. There is no in-flight user edit to protect here.
  await persistDocument(state, doc);
  advancePendingBaseVersion(state, doc);
  state.runtime.util.log(
    `Documents: recovered ${recovered.length} attachment slot(s) from pending uploads after an interrupted write.`,
  );
}

async function initializeDocumentStore(
  state: DocumentStoreState,
  scheduleSync: () => void,
) {
  if (state.runtime.infra.dbStatus !== "ready") {
    return;
  }

  const nextDoc = await createStoredDocument(state);
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
      importSnapshot(nextDoc, base64ToBytes(existing.loroSnapshot));
    }

    state.record = existing;
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
      loroSnapshot: bytesToBase64(exportShallowSnapshot(nextDoc)),
      accessEpoch: DEFAULT_DOCUMENT_ACCESS_EPOCH,
      accessStateHash: null,
      effectiveAccessLevel: "admin",
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
  }

  state.doc = nextDoc;
  // Restore the durable outgoing-delta marker. Re-seeding it to the loaded
  // snapshot version would move it PAST any device-first `deferRemoteSync` op
  // (persisted into the snapshot but deliberately left un-enqueued and behind
  // the marker), permanently dropping that op from sync across a restart. When a
  // marker was persisted, restore it so the next edit still re-derives the
  // deferred delta. Only seed to the loaded version for rows that never
  // persisted one (freshly created here, or pre-migration).
  const persistedMarker = existing?.pendingBaseVersion ?? null;
  if (persistedMarker !== null) {
    state.pendingBaseVersion = persistedMarker;
  } else {
    advancePendingBaseVersion(state, nextDoc);
  }
  // Heal attachment slots lost to an interrupted attach write before marking
  // ready, so the recovered slots are in the snapshot the editor first renders
  // and are queued for sync. recoverDroppedAttachmentSlots advances the marker
  // again for whatever it re-derives.
  await recoverDroppedAttachmentSlots(state, nextDoc);
  state.initialized = true;
  state.initializePromise = null;
  setReadySnapshot(state, nextDoc, false);
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

  // Relink rewrites access/identity metadata, not content. If it lands while the
  // user is mid-edit, re-deriving text/structured fields from the (possibly
  // lagging) doc would republish a stale read over the live optimistic snapshot
  // and drop in-flight keystrokes; preserve the snapshot like the keystroke and
  // sync persists do.
  const { record: nextRecord, updatedAt } = await persistDocument(
    state,
    state.doc,
    patch,
    { preserveSnapshotStructuredFields: true, preserveSnapshotText: true },
  );
  return {
    accessStateHash: nextRecord.accessStateHash ?? null,
    effectiveAccessLevel: normalizeEffectiveAccessLevel(
      nextRecord.effectiveAccessLevel,
    ),
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

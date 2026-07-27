import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportFullHistorySnapshot,
  getImportBlobMetadata,
  importSnapshot,
  mergeVersionVectors,
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
import { ensureDocumentRowsStructure } from "../../../data/documents/documentRowList";
import {
  DOCUMENTS_APP_KIND,
  type DocumentRecord,
  type DocumentsPersistence,
  importDocumentHistoryTailUpdates,
  isDatabaseUnavailableError,
  type LocalAttachmentRecord,
  loadPersistedDocumentStoreState,
} from "../../../workflows/documents";
import type { DocumentStoreRelinkInput } from "../types";
import { reconcileLocalAttachmentDetachState } from "./attachmentDetachState";
import { chainIdentityWrite } from "./identityWriteChain";
import {
  advancePendingBaseVersion,
  enqueuePendingUpdate,
  pendingDeltaSinceBase,
  persistDocument,
  saveDocumentRecord,
  saveLocalAttachmentRecord,
} from "./persistence";
import { logRevalidationScheduled } from "./remoteRevalidationTelemetry";
import {
  type DocumentState,
  type DocumentStoreState,
  setReadySnapshot,
} from "./state";
import {
  captureDocumentStoreSyncGeneration,
  type DocumentStoreSyncGeneration,
} from "./syncGeneration";

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
  ensureDocumentRowsStructure(createdDoc);
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
  writeGeneration: DocumentStoreSyncGeneration,
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
  // Every durable write is gated on the captured generation — the enqueue
  // validates it INSIDE its serialized mutation, and the persist re-checks
  // via its expectedGeneration overload — so a store reset (e.g. a
  // local-edits discard) racing this recovery cannot see it re-enqueue or
  // re-persist the state the teardown just removed.
  if (update.byteLength > 0) {
    await enqueuePendingUpdate(state, update, undefined, writeGeneration);
  }
  // Derive the snapshot from the loaded doc (do NOT preserve the snapshot). This
  // runs during init, before the store is ready, so state.snapshot is still the
  // empty initial snapshot — preserving it would publish a ready snapshot with
  // empty text/structured fields (a flash of empty content) over the real loaded
  // content. There is no in-flight user edit to protect here. The doc is
  // private to initialization and the enqueue above dual-wrote its delta, so
  // its version is a durably covered frontier.
  const persisted = await persistDocument(
    state,
    doc,
    { snapshotEndVersion: encodeVersionVector(doc) },
    {},
    writeGeneration,
  );
  if (!persisted) {
    return;
  }
  advancePendingBaseVersion(state, doc);
  state.runtime.util.log(
    `Documents: recovered ${recovered.length} attachment slot(s) from pending uploads after an interrupted write.`,
  );
}

/**
 * Realign detach markers with the loaded document.
 *
 * Removing an attachment marks its row detached and then persists the document;
 * a stop between those two writes leaves the halves disagreeing, and neither
 * the sync detach pass (which reads the document) nor the read models (which
 * read the marker) can resolve that on their own. The loaded document is the
 * durable truth, so the marker follows it.
 */
async function healLocalAttachmentDetachState(
  state: DocumentStoreState,
  doc: DocumentState,
  persistedState: { localAttachments: ReadonlyArray<LocalAttachmentRecord> },
  writeGeneration: DocumentStoreSyncGeneration,
): Promise<void> {
  const healed = reconcileLocalAttachmentDetachState(
    persistedState.localAttachments,
    doc,
  );
  for (const attachment of healed) {
    // The save validates the generation inside its serialized mutation, so a
    // concurrent store reset can never see this heal rewrite rows the
    // teardown just removed.
    await saveLocalAttachmentRecord(state, attachment, doc, writeGeneration);
  }
  if (healed.length > 0) {
    state.runtime.util.log(
      `Documents: realigned ${healed.length} attachment detach marker(s) with the loaded document.`,
    );
  }
}

/**
 * Restore the persisted content into a fresh document from the durable
 * full-history state (checkpoint + tail) — the ONLY persisted content
 * source. Every document seeds its checkpoint at birth, so a record without
 * one is a discovered shell that has not hydrated yet: the document starts
 * empty and the remote pull supplies the content.
 */
type RestoredHistoryState = NonNullable<
  Awaited<ReturnType<DocumentsPersistence["loadHistoryRestoreState"]>>
>;

async function restorePersistedDocumentContent(
  state: DocumentStoreState,
  nextDoc: DocumentState,
): Promise<RestoredHistoryState | null> {
  const history = await state.persistence.loadHistoryRestoreState(
    state.runtime.infra.execSql,
    state.localId,
  );
  if (!history) {
    return null;
  }

  // A tail-only state (crash before the birth checkpoint landed) has an
  // empty snapshot; the tail rows alone carry the content.
  if (history.snapshot.length > 0) {
    importSnapshot(nextDoc, base64ToBytes(history.snapshot));
  }
  importDocumentHistoryTailUpdates(
    nextDoc,
    history.tailUpdates.map((update) => update.updateData),
  );
  return history;
}

/**
 * End versions of the restored REMOTE tail rows — ops the server already
 * holds, so the outgoing-delta marker may advance across them. Unparseable
 * rows are skipped (they never advance the marker; failing toward re-sending
 * is the recoverable direction).
 */
function restoredRemoteTailCoverage(
  history: RestoredHistoryState | null,
): string[] {
  if (!history) {
    return [];
  }
  return history.tailUpdates.flatMap((update) => {
    if (update.origin !== "remote") {
      return [];
    }
    try {
      return [
        getImportBlobMetadata(base64ToBytes(update.updateData))
          .partialEndVersionVector,
      ];
    } catch {
      return [];
    }
  });
}

async function createInitialDocumentRecord(
  state: DocumentStoreState,
  nextDoc: DocumentState,
): Promise<void> {
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
    snapshotEndVersion: encodeVersionVector(nextDoc),
    accessEpoch: DEFAULT_DOCUMENT_ACCESS_EPOCH,
    accessStateHash: null,
    effectiveAccessLevel: "admin",
    lastCommitLsn: null,
    contentKeyBundle: null,
    documentKekTargets: null,
    documentManifestBundle: null,
  };
  // Seed the durable-history checkpoint at birth, BEFORE the record row:
  // creation may be the only persist this document sees before a restart
  // (offline note, app closed pre-sync), and initialization only runs this
  // branch for missing records — a crash after the record write but before
  // a later checkpoint write would permanently disable durable history for
  // this document. Written first, a crash instead leaves an orphan
  // checkpoint that the re-run simply overwrites. A fresh document is tiny,
  // so the export is cheap.
  await state.persistence.replaceHistoryCheckpoint(
    state.runtime.infra.execSql,
    {
      coveredTailIds: [],
      endVersionVector: encodeVersionVector(nextDoc),
      force: true,
      localId: state.localId,
      snapshot: bytesToBase64(exportFullHistorySnapshot(nextDoc)),
    },
  );
  // The birth checkpoint just written covers exactly this frontier.
  await saveDocumentRecord(state, nextDoc, {
    ...created,
    snapshotEndVersion: encodeVersionVector(nextDoc),
  });
  if (
    state.initialText.length > 0 ||
    state.initialDocumentKind !== DEFAULT_DOCUMENT_KIND
  ) {
    await enqueuePendingUpdate(state, exportAllUpdates(nextDoc));
  }
}

async function initializeDocumentStore(
  state: DocumentStoreState,
  scheduleSync: () => void,
) {
  if (state.runtime.infra.dbStatus !== "ready") {
    return;
  }

  // A store reset while this fire-and-forget initialization is loading (a
  // runtime swap, or a local-edits discard that re-seeds the persisted rows)
  // must win: assigning the state loaded BEFORE the reset would bring the
  // replaced record and doc back to life. Every reset bumps the local write
  // generation, so a stale capture here aborts before each assignment batch.
  const initializeGeneration = state.localWriteGeneration;

  const nextDoc = await createStoredDocument(state);
  const persistedState = await loadPersistedDocumentStoreState({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
  });
  if (state.localWriteGeneration !== initializeGeneration) {
    return;
  }
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
  let restoredHistory: RestoredHistoryState | null = null;
  if (existing) {
    restoredHistory = await restorePersistedDocumentContent(state, nextDoc);
    // Check BEFORE assigning: a reset during the restore's I/O must not see
    // the pre-reset record written back over the replacement's state.
    if (state.localWriteGeneration !== initializeGeneration) {
      return;
    }
    state.record = existing;
  } else {
    await createInitialDocumentRecord(state, nextDoc);
    if (state.localWriteGeneration !== initializeGeneration) {
      return;
    }
  }

  state.doc = nextDoc;
  // Restore the durable outgoing-delta marker. Re-seeding it to the restored
  // document's version would move it PAST any device-first `deferRemoteSync`
  // op (persisted into the durable history but deliberately left un-enqueued
  // and behind the marker), permanently dropping that op from sync across a
  // restart. When a marker was persisted, restore it so the next edit still
  // re-derives the deferred delta. Only seed for rows that never persisted
  // one, from the RECORD's persisted frontier rather than the restored
  // document: a crash between the tail append and the queue/marker writes can
  // resurrect ops the outgoing queue never durably received, and seeding from
  // the restored document would classify those as covered and orphan them
  // from sync forever.
  const persistedMarker = existing?.pendingBaseVersion ?? null;
  const markerBase =
    persistedMarker ??
    (existing && existing.snapshotEndVersion.length > 0
      ? existing.snapshotEndVersion
      : null);
  if (markerBase !== null) {
    // Extend the base across the restored REMOTE tail rows: a crash between
    // the pulled-updates append and the record persist leaves the durable
    // marker behind ops the server already holds, and without this merge the
    // next edit's delta would re-upload all of that pulled content. Local
    // rows never advance it — an un-enqueued deferred op must stay below the
    // marker so the next edit re-derives and sends it.
    const remoteCoverage = restoredRemoteTailCoverage(restoredHistory);
    state.pendingBaseVersion =
      remoteCoverage.length > 0
        ? mergeVersionVectors([markerBase, ...remoteCoverage])
        : markerBase;
  } else {
    advancePendingBaseVersion(state, nextDoc);
  }
  // Heal attachment slots lost to an interrupted attach write before marking
  // ready, so the recovered slots are in the snapshot the editor first renders
  // and are queued for sync. recoverDroppedAttachmentSlots advances the marker
  // again for whatever it re-derives. Both helpers gate every durable write
  // on this generation (validated inside the writes' serialized mutations),
  // so a reset mid-helper cannot repopulate discarded state.
  const writeGeneration = captureDocumentStoreSyncGeneration(state, nextDoc);
  if (!writeGeneration) {
    return;
  }
  await recoverDroppedAttachmentSlots(state, nextDoc, writeGeneration);
  if (state.localWriteGeneration !== initializeGeneration) {
    return;
  }
  await healLocalAttachmentDetachState(
    state,
    nextDoc,
    persistedState,
    writeGeneration,
  );
  if (state.localWriteGeneration !== initializeGeneration) {
    return;
  }
  state.initialized = true;
  state.initializePromise = null;
  setReadySnapshot(state, nextDoc, false);

  if (existing?.documentId) {
    // Websocket invalidations are intentionally session-local. A process can
    // stop before receiving a peer device's update event, and no event survives
    // the restart to distinguish a clean local snapshot from a stale one. Probe
    // each opened remote document once after loading it; unopened documents stay
    // lazy, while body and attachment state for a restored window converges.
    state.remoteUpdatePending = true;
    state.remoteUpdateSignalSeq += 1;
    logRevalidationScheduled(state.runtime, "startup");
  }
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

      if (isDatabaseUnavailableError(error)) {
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
    if (isDatabaseUnavailableError(error)) {
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
  const currentDoc = state.doc;
  // Read the record and persist on the identity-write chain so an in-flight
  // eager create cannot interleave: a create that captured a null identity
  // before its network round trip would otherwise write the derived documentId
  // over the one this relink assigns.
  const { record: nextRecord, updatedAt } = await chainIdentityWrite(
    state,
    async () => {
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

      // Relink rewrites access/identity metadata, not content. If it lands while
      // the user is mid-edit, re-deriving text/structured fields from the
      // (possibly lagging) doc would republish a stale read over the live
      // optimistic snapshot and drop in-flight keystrokes; preserve the snapshot
      // like the keystroke and sync persists do.
      return persistDocument(state, currentDoc, patch, {
        preserveSnapshotStructuredFields: true,
        preserveSnapshotText: true,
      });
    },
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

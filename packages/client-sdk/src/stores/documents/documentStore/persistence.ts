import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import {
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getImportBlobMetadata,
  satisfiesVersionVector,
} from "@symcrypt/loro";
import { normalizeEffectiveAccessLevel } from "../../../data/accessLevel";
import { DEFAULT_DOCUMENT_KIND } from "../../../data/documents/documentConstants";
import {
  type DocumentProjectorRegistry,
  projectStoredDocumentState,
} from "../../../data/documents/documentKinds";
import type { DocumentSummary } from "../../../data/documents/documentSummary";
import { errorMessage } from "../../../data/errorMessage";

import {
  DOCUMENT_HISTORY_COMPACTION_MAX_BYTES,
  DOCUMENT_HISTORY_COMPACTION_MAX_ROWS,
  type DocumentRecord,
  defaultDocumentsPersistence,
  type ExecSql,
  enqueuePendingDocumentUpdate,
  listPendingDocumentUpdates,
  type PendingUpdateRecord,
  persistDocumentState,
  reclaimDocumentOrphanBlobs,
  runSerializedSqlMutation,
} from "../../../workflows/documents";
import {
  importDurableDocumentHistory,
  installDurableDocumentReload,
} from "./durableDocumentReload";
import {
  type DocumentState,
  type DocumentStoreState,
  markDocumentStoreRemoved,
  type PersistedDocumentRecord,
  type SaveDocumentRecordOptions,
  setReadySnapshot,
} from "./state";
import { createFreshPeerStoredDocument } from "./storedDocument";
import {
  captureDocumentStoreSyncGeneration,
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent as isSyncGenerationCurrent,
} from "./syncGeneration";

export function documentSummaryFromRecord(
  record: DocumentRecord,
  updatedAt: string,
  documentProjectors: DocumentProjectorRegistry,
): DocumentSummary {
  return {
    accessStateHash: record.accessStateHash ?? null,
    effectiveAccessLevel: normalizeEffectiveAccessLevel(
      record.effectiveAccessLevel,
    ),
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

function toPersistedDocumentRecord(
  persisted: NonNullable<Awaited<ReturnType<typeof persistDocumentState>>>,
): PersistedDocumentRecord {
  const { record, updatedAt } = persisted;
  return {
    ...(persisted.creationSuperseded
      ? { creationSuperseded: true as const }
      : {}),
    historyRestoreState: persisted.historyRestoreState,
    ...(persisted.pullContinuationSuperseded
      ? { pullContinuationSuperseded: true as const }
      : {}),
    record,
    ...(persisted.syncIdentitySuperseded
      ? { syncIdentitySuperseded: true as const }
      : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

// Nullable without a generation too: an update-persist refuses (returns
// null) when the durable row was deleted while the persist was queued — the
// resurrect guard in persistDocumentState — so callers must stop follow-up
// state changes on null.
export async function saveDocumentRecord(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  patch: Partial<DocumentRecord> = {},
  options: SaveDocumentRecordOptions = {},
  expectedGeneration?: DocumentStoreSyncGeneration,
): Promise<PersistedDocumentRecord | null> {
  const previousDocumentId = state.record?.documentId ?? null;
  const pendingBaseVersion =
    options.pendingBaseVersionOverride === undefined
      ? state.pendingBaseVersion
      : options.pendingBaseVersionOverride;
  const persistenceInput = {
    acceptedPendingUpdateIds: options.acceptedPendingUpdateIds,
    attachmentRemoval: options.attachmentRemoval,
    attachmentStaging: options.attachmentStaging,
    clearSyncFailure: options.clearSyncFailure,
    containerId: state.runtime.state.containerId,
    currentDoc,
    currentRecord: state.record,
    documentProjectors: state.runtime.infra.documentProjectors,
    execSql: state.runtime.infra.execSql,
    expectedSyncState: options.expectedSyncState,
    historyCheckpoint: options.historyCheckpoint,
    historyUpdateOrigin: options.historyUpdateOrigin,
    historyUpdates: options.historyUpdates,
    pendingUpdate: options.pendingUpdate,
    localId: state.localId,
    // Persist the durable outgoing-delta marker with every snapshot write so a
    // restart restores it (see initializeDocumentStore). A device-first
    // deferRemoteSync write leaves it BEHIND the snapshot version on purpose;
    // capturing state.pendingBaseVersion here is what lets the next edit
    // re-derive that deferred op after a restart instead of dropping it.
    patch: { ...patch, pendingBaseVersion },
    persistence: state.persistence,
  };
  const persistedDocumentState = expectedGeneration
    ? await persistDocumentState({
        ...persistenceInput,
        // persistDocumentState rechecks after its own pre-save awaits and then
        // immediately claims the executor mutation queue. A reset before that
        // point aborts; a reset afterward cannot let replacement writes overtake.
        canStartDurableMutation: () =>
          isSyncGenerationCurrent(state, expectedGeneration),
      })
    : await persistDocumentState(persistenceInput);
  if (!persistedDocumentState) {
    // With a stale generation the teardown that invalidated it owns the
    // state. With a current (or absent) generation, the refusal means the
    // durable row was deleted by ANOTHER subsystem while this persist was
    // queued (the resurrect guard): this store is a zombie — clear it so
    // callers that ignore the result stop advancing state or scheduling
    // sync against a document that no longer exists.
    if (
      !expectedGeneration ||
      isSyncGenerationCurrent(state, expectedGeneration)
    ) {
      markDocumentStoreRemoved(state);
    }
    if (state.persistence === defaultDocumentsPersistence) {
      void reclaimDocumentOrphanBlobs(state.runtime);
    }
    return null;
  }
  const { record: nextRecord, updatedAt } = persistedDocumentState;
  if (
    expectedGeneration &&
    !isSyncGenerationCurrent(state, expectedGeneration)
  ) {
    return null;
  }

  state.record = persistedDocumentState.record;
  state.pullContinuation = nextRecord.pullContinuation ?? null;
  if (persistedDocumentState.pullContinuationSuperseded) {
    state.pendingBaseVersion =
      nextRecord.pendingBaseVersion ?? nextRecord.snapshotEndVersion;
  }
  if (previousDocumentId !== nextRecord.documentId) {
    state.effects.registerDocumentIdentity(
      state.runtime.state.domainScope,
      nextRecord.id,
      nextRecord.documentId,
    );
  }
  if (updatedAt !== undefined) {
    state.effects.emitPersistedDocument(
      state.runtime.state.domainScope,
      documentSummaryFromRecord(
        nextRecord,
        updatedAt,
        state.runtime.infra.documentProjectors,
      ),
    );
  }
  return toPersistedDocumentRecord(persistedDocumentState);
}

async function reloadSupersededDocumentState(
  state: DocumentStoreState,
  expectedGeneration: DocumentStoreSyncGeneration | undefined,
  historyRestoreState: PersistedDocumentRecord["historyRestoreState"],
  previousDocumentId: string | null,
  durableRecord: DocumentRecord,
): Promise<DocumentState | null> {
  if (historyRestoreState === undefined) {
    throw new Error("Superseded document state omitted its durable history");
  }
  const replacementDoc = await createFreshPeerStoredDocument();
  importDurableDocumentHistory(replacementDoc, historyRestoreState);
  if (
    expectedGeneration &&
    !isSyncGenerationCurrent(state, expectedGeneration)
  ) {
    return null;
  }
  installDurableDocumentReload({
    durableRecord,
    previousDocumentId,
    preserveQueuedWritesWhenIdentityMatches: true,
    registerIdentityChange: false,
    replacementDoc,
    state,
  });
  return replacementDoc;
}

export async function persistDocument(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  patch: Partial<DocumentRecord> = {},
  options: SaveDocumentRecordOptions = {},
  expectedGeneration?: DocumentStoreSyncGeneration,
): Promise<PersistedDocumentRecord | null> {
  const previousDocumentId = state.record?.documentId ?? null;
  const persistedRecord = await saveDocumentRecord(
    state,
    currentDoc,
    patch,
    options,
    expectedGeneration,
  );
  if (!persistedRecord) return null;
  if (expectedGeneration && !isSyncGenerationCurrent(state, expectedGeneration))
    return null;

  if (
    persistedRecord.syncIdentitySuperseded ||
    persistedRecord.pullContinuationSuperseded
  ) {
    // A sync finalize imports remote updates into the live CRDT before its
    // durable continuation CAS. If that CAS loses, its history rows were not
    // appended either; keeping the mutated live CRDT would advance the next
    // request frontier past data that cannot survive a restart. Rebuild from
    // the winning durable checkpoint/tail for every CAS loss, not only an
    // identity replacement.
    const replacementDoc = await reloadSupersededDocumentState(
      state,
      expectedGeneration,
      persistedRecord.historyRestoreState,
      previousDocumentId,
      persistedRecord.record,
    );
    if (!replacementDoc) return null;
    return persistedRecord;
  }

  setReadySnapshot(
    state,
    currentDoc,
    state.snapshot.syncing,
    options.preserveSnapshotText && !persistedRecord.pullContinuationSuperseded
      ? state.snapshot.text
      : persistedRecord.record.text,
    options.preserveSnapshotStructuredFields &&
      !persistedRecord.pullContinuationSuperseded
      ? state.snapshot.structuredFields
      : undefined,
  );
  // Compaction never fails the persist that triggered it: an unexpected
  // compaction error simply keeps the tail growing until a later pass
  // succeeds, and the content stays durable either way.
  try {
    await maybeCompactDocumentHistory(state, currentDoc);
  } catch (error) {
    state.runtime.util.log(
      `Documents: history compaction skipped: ${errorMessage(error)}`,
    );
  }
  return persistedRecord;
}

/**
 * Refresh the durable full-history checkpoint when the tail has grown past
 * the compaction thresholds, or seed the first checkpoint as soon as the
 * document can export full history (a freshly created or rebuilt document is
 * cheap to export; waiting for the threshold would leave restarts without
 * history until then). The snapshot comes from the LIVE document, which has
 * every tail update imported, so clearing the tail loses nothing.
 */
async function maybeCompactDocumentHistory(
  state: DocumentStoreState,
  currentDoc: DocumentState,
): Promise<void> {
  const { persistence } = state;
  // Bind this compaction to the store context it started under: a store
  // reset or runtime swap mid-compaction must not let the OLD document's
  // checkpoint overwrite the replacement generation's history (or land in a
  // newly selected database).
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) {
    return;
  }
  const execSql = state.runtime.infra.execSql;
  const tail = await persistence.readHistoryTailSize(execSql, state.localId);
  if (
    tail.hasCheckpoint &&
    tail.rowCount < DOCUMENT_HISTORY_COMPACTION_MAX_ROWS &&
    tail.byteLength < DOCUMENT_HISTORY_COMPACTION_MAX_BYTES
  ) {
    return;
  }

  // Capture the tail BEFORE exporting, then prove coverage per row: another
  // pane can append ops this pane's document has not merged, so blanket
  // deletion would discard the only durable copy. Unproven rows survive for
  // a later compaction by whichever pane holds their ops.
  const tailEntries = await persistence.listHistoryTailEntries(
    execSql,
    state.localId,
  );
  const snapshot = exportFullHistorySnapshot(currentDoc);
  if (!isSyncGenerationCurrent(state, generation)) {
    return;
  }
  const endVersionVector = encodeVersionVector(currentDoc);
  await persistence.replaceHistoryCheckpoint(execSql, {
    coveredTailIds: coveredHistoryTailIds(tailEntries, endVersionVector),
    endVersionVector,
    localId: state.localId,
    snapshot: bytesToBase64(snapshot),
    stillCurrent: () => isSyncGenerationCurrent(state, generation),
  });
}

/**
 * The tail rows provably covered by a document at `documentVersion`: rows
 * whose update span the version satisfies, plus rows whose payload cannot be
 * parsed at all (they could never replay and would only poison restores).
 */
function coveredHistoryTailIds(
  tailEntries: readonly { id: string; updateData: string }[],
  documentVersion: string,
): string[] {
  return tailEntries.flatMap((entry) => {
    try {
      const metadata = getImportBlobMetadata(base64ToBytes(entry.updateData));
      return satisfiesVersionVector(
        documentVersion,
        metadata.partialEndVersionVector,
      )
        ? [entry.id]
        : [];
    } catch {
      return [entry.id];
    }
  });
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

/**
 * Runs a durable write either ungated — no generation: the caller serializes
 * with teardown via the write-chain drain, and the persistence implementation
 * may legitimately park inside the write WITHOUT holding the global mutation
 * mutex — or inside the serialized mutation with an in-mutex currency check:
 * a teardown (reset/discard) that already ran was ordered strictly before the
 * mutation claim and invalidated the generation, so a stale caller can no
 * longer slip its write in after the teardown's wipe; a write that wins the
 * ordering instead lands before the teardown and is wiped by it. Returns
 * whether the write ran.
 */
export async function withGenerationGuardedMutation(
  state: DocumentStoreState,
  expectedGeneration: DocumentStoreSyncGeneration | undefined,
  write: (execSql: ExecSql) => Promise<void>,
): Promise<boolean> {
  if (!expectedGeneration) {
    await write(state.runtime.infra.execSql);
    return true;
  }

  let ran = false;
  await runSerializedSqlMutation(
    state.runtime.infra.execSql,
    async (lockedExecSql) => {
      if (!isSyncGenerationCurrent(state, expectedGeneration)) {
        return;
      }
      await write(lockedExecSql);
      ran = true;
    },
  );
  return ran;
}

export async function enqueuePendingUpdate(
  state: DocumentStoreState,
  update: Uint8Array,
  sourceVersionVector?: string | null,
  expectedGeneration?: DocumentStoreSyncGeneration,
): Promise<boolean> {
  const expectedDocumentId = state.record?.documentId;
  const expectedRecoveryGeneration = state.record?.recoveryGeneration ?? 0;
  if (expectedDocumentId === undefined) {
    return false;
  }
  let enqueued = false;
  const ran = await withGenerationGuardedMutation(
    state,
    expectedGeneration,
    async (execSql) => {
      enqueued = await enqueuePendingDocumentUpdate({
        execSql,
        expectedDocumentId,
        expectedRecoveryGeneration,
        localId: state.localId,
        persistence: state.persistence,
        ...(sourceVersionVector === undefined ? {} : { sourceVersionVector }),
        update,
      });
    },
  );
  return ran && enqueued;
}

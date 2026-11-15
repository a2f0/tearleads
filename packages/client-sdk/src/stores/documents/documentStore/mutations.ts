import { bytesToBase64 } from "@tearleads/encoding";
import { encodeVersionVector, getTextValue } from "@tearleads/loro";
import {
  projectStoredDocumentState,
  type StoredDocumentKind,
  writeStoredDocumentFields,
} from "../../../data/documents/documentKinds";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import { requestDocumentStoreSync } from "../registry";
import type {
  DocumentMutationOptions,
  DocumentStructuredFieldPatch,
} from "../types";
import {
  ensureDocumentStoreInitialized,
  ensureDocumentStoreReady,
} from "./initialization";
import {
  chainQueuedWrite,
  isLocalWriteSuperseded,
  issueLocalWriteTicket,
  type LocalWriteKey,
  type LocalWriteTicket,
} from "./localWriteQueue";
import { revalidateDocumentMutationIdentity } from "./mutationIdentityRevalidation";
import {
  advancePendingBaseVersion,
  pendingDeltaSinceBase,
  persistDocument,
} from "./persistence";
import { reportDocumentStoreWriteFailure } from "./reportWriteFailure";
import {
  canWriteDocument,
  type DocumentState,
  type DocumentStoreState,
  type SaveDocumentRecordOptions,
  setDocumentSnapshot,
  setReadySnapshot,
} from "./state";
import { captureDocumentStoreSyncGeneration } from "./sync/syncGeneration";

// Fixed literals: a reported message must never carry document text or ids.
const TEXT_FAILURE_MESSAGE = "Documents: local text persist failed";
const FIELD_FAILURE_MESSAGE = "Documents: local field persist failed";

function structuredMutationDurabilityOptions(
  options: DocumentMutationOptions,
  update: Uint8Array,
): Pick<SaveDocumentRecordOptions, "historyUpdates" | "pendingUpdate"> | null {
  if (options.deferRemoteSync) {
    return { historyUpdates: [bytesToBase64(update)] };
  }
  const pendingUpdate = createPendingUpdateFields(update);
  return pendingUpdate ? { pendingUpdate } : null;
}

function isDocumentLocalWriteCurrent(
  state: DocumentStoreState,
  writeGeneration: number,
  writeDoc: DocumentState,
): boolean {
  return (
    state.localWriteGeneration === writeGeneration && state.doc === writeDoc
  );
}

function settleDocumentLocalWrite(
  state: DocumentStoreState,
  writeGeneration: number,
): void {
  // Reset/reinitialization owns the new generation's counter. A write queued
  // against the prior document must touch neither it nor the replacement doc.
  if (state.localWriteGeneration !== writeGeneration) {
    return;
  }

  state.pendingLocalWrites = Math.max(0, state.pendingLocalWrites - 1);
  if (state.pendingLocalWrites !== 0 || !state.doc) {
    return;
  }

  // A sync pass or rotation may merge remote content while preserving the
  // controlled editor value. Publish the authoritative doc once typing drains;
  // setReadySnapshot is a no-op when the optimistic projection already matches.
  setReadySnapshot(state, state.doc, state.snapshot.syncing);
}

function publishDocumentTextSnapshot(
  state: DocumentStoreState,
  value: string,
): void {
  setDocumentSnapshot(state, {
    ...state.snapshot,
    text: value,
    title: projectStoredDocumentState(
      {
        documentKind: state.snapshot.documentKind,
        structuredFields: state.snapshot.structuredFields,
        text: value,
        rows: state.snapshot.rows.map((row) => ({
          id: row.id,
          fields: row.fields,
        })),
      },
      state.runtime.infra.documentProjectors,
    ).title,
  });
}

async function writeDocumentText(
  state: DocumentStoreState,
  writeGeneration: number,
  ticket: LocalWriteTicket,
  value: string,
): Promise<void> {
  // A newer queued setText carries the whole latest value, and its persist
  // exports every op since pendingBaseVersion: this one has nothing to add.
  if (
    isLocalWriteSuperseded(state, ticket) ||
    state.localWriteGeneration !== writeGeneration ||
    !state.doc ||
    !canWriteDocument(state)
  ) {
    return;
  }
  const writeDoc = state.doc;
  const syncGeneration = captureDocumentStoreSyncGeneration(state, writeDoc);
  if (!syncGeneration) {
    return;
  }

  const textChanged = getTextValue(writeDoc) !== value;
  // Equal text still persists when an earlier write applied ops that never
  // became durable (its save failed, and the write in between was superseded):
  // this write is the last one queued to carry them. Without such edits it
  // only revalidates, so a deferred birth keeps riding the next real edit.
  if (!textChanged && !state.unsavedLocalEdits) {
    await revalidateDocumentMutationIdentity({
      currentDoc: writeDoc,
      generation: syncGeneration,
      state,
    });
    return;
  }
  if (textChanged) {
    writeDoc.getText("text").update(value);
  }
  const update = pendingDeltaSinceBase(state, writeDoc);
  // Captured at delta time: the enqueued row proves durable coverage up
  // to exactly this version, so this is the frontier the persist may
  // publish (a raced later edit publishes its own on its own persist).
  const coveredVersion = encodeVersionVector(writeDoc);
  const pendingUpdate = createPendingUpdateFields(update);
  if (!pendingUpdate) {
    // Nothing outstanding to enqueue: still adopt a relinked identity.
    await revalidateDocumentMutationIdentity({
      currentDoc: writeDoc,
      generation: syncGeneration,
      state,
    });
    return;
  }
  // From here until a persist covers it, the doc holds edits SQLite lacks.
  state.unsavedLocalEdits = true;
  const persisted = await persistDocument(
    state,
    writeDoc,
    { snapshotEndVersion: coveredVersion },
    { pendingUpdate, preserveSnapshotText: true },
    syncGeneration,
  );
  if (
    !persisted ||
    !isDocumentLocalWriteCurrent(state, writeGeneration, writeDoc)
  ) {
    return;
  }
  advancePendingBaseVersion(state, writeDoc);
  requestDocumentStoreSync(state);
}

function queueDocumentTextWrite(
  state: DocumentStoreState,
  value: string,
): Promise<void> {
  if (!state.doc) {
    return Promise.resolve();
  }
  const writeGeneration = state.localWriteGeneration;
  // Supersedes every text write still queued: only the newest reaches SQLite.
  // Field, row, and attachment writes never supersede a text write.
  const ticket = issueLocalWriteTicket(state, ["text"]);

  // Mark a local edit as in flight SYNCHRONOUSLY, before chaining, so a sync
  // pass that runs during this burst sees pendingLocalWrites > 0 and preserves
  // the optimistic snapshot instead of regressing it to a stale doc read.
  state.pendingLocalWrites += 1;
  return chainQueuedWrite(
    state,
    state.writeChain
      .catch(() => undefined)
      .then(() => writeDocumentText(state, writeGeneration, ticket, value))
      // The user is already looking at this text: publishDocumentTextSnapshot ran
      // before the chain, and nothing downstream surfaces a failed persist.
      .catch((error: unknown) => {
        reportDocumentStoreWriteFailure(state, TEXT_FAILURE_MESSAGE, error);
      })
      // Always settle, even on supersession, the value-equality short-circuit,
      // or a throw, so the current document's counter cannot stick non-zero.
      // The generation guard keeps a reset write from decrementing a
      // replacement generation.
      .finally(() => {
        settleDocumentLocalWrite(state, writeGeneration);
      }),
  );
}

function publishDocumentStructuredFieldSnapshot(
  state: DocumentStoreState,
  kind: Exclude<StoredDocumentKind, "note">,
  patch: DocumentStructuredFieldPatch,
): void {
  const nextStructuredFields: Record<string, unknown> = {
    ...state.snapshot.structuredFields,
  };
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete nextStructuredFields[field];
    } else {
      nextStructuredFields[field] = value;
    }
  }
  const projectedState = projectStoredDocumentState(
    {
      documentKind: kind,
      structuredFields: nextStructuredFields,
      text: state.snapshot.text,
      rows: state.snapshot.rows.map((row) => ({
        id: row.id,
        fields: row.fields,
      })),
    },
    state.runtime.infra.documentProjectors,
  );

  setDocumentSnapshot(state, {
    ...state.snapshot,
    documentKind: projectedState.documentKind,
    fieldValidationIssues: projectedState.fieldValidationIssues,
    structuredFields: projectedState.structuredFields,
    title: projectedState.title,
  });
}

interface StructuredFieldWrite {
  readonly kind: Exclude<StoredDocumentKind, "note">;
  readonly options: DocumentMutationOptions;
  readonly patch: DocumentStructuredFieldPatch;
  /** Deferred or guarded writes neither supersede nor coalesce. */
  readonly ticket: LocalWriteTicket | null;
  readonly writeGeneration: number;
}

async function writeDocumentStructuredFields(
  state: DocumentStoreState,
  write: StructuredFieldWrite,
): Promise<void> {
  const { kind, options, patch, ticket, writeGeneration } = write;
  // Newer queued patches set every field of this one, and the one persisting
  // them exports every op since pendingBaseVersion: nothing to add here.
  if (
    isLocalWriteSuperseded(state, ticket) ||
    state.localWriteGeneration !== writeGeneration ||
    !state.doc ||
    !canWriteDocument(state)
  ) {
    return;
  }
  const writeDoc = state.doc;
  const syncGeneration = captureDocumentStoreSyncGeneration(state, writeDoc);
  if (!syncGeneration) {
    return;
  }

  if (options.stillCurrent?.() === false) return;
  writeStoredDocumentFields(
    writeDoc,
    kind,
    patch,
    state.runtime.infra.documentProjectors,
  );
  const update = pendingDeltaSinceBase(state, writeDoc);
  if (update.byteLength === 0) {
    await revalidateDocumentMutationIdentity({
      currentDoc: writeDoc,
      generation: syncGeneration,
      state,
    });
    return;
  }
  // Captured at delta time: the durable row written below (queue
  // dual-write or in-mutation tail append) proves coverage up to exactly
  // this version, so it is the frontier this persist may publish.
  const coveredVersion = encodeVersionVector(writeDoc);
  const durabilityOptions = structuredMutationDurabilityOptions(
    options,
    update,
  );
  if (!durabilityOptions) {
    await revalidateDocumentMutationIdentity({
      currentDoc: writeDoc,
      generation: syncGeneration,
      state,
    });
    return;
  }
  // From here until a persist covers it, the doc holds edits SQLite lacks.
  state.unsavedLocalEdits = true;
  // A deferred write advances the record's content frontier AHEAD of the
  // outgoing queue (the op is re-derived by the next edit). Its delta
  // rides in the persist's own claimed mutation as a durable-history tail
  // row written before the record — the tail is the only content store,
  // so the record frontier must never durably lead the tail row that
  // holds its content. Passed as an option (no pre-persist await) so this
  // write adds no extra hop that would change cross-store interleaving.
  const persisted = await persistDocument(
    state,
    writeDoc,
    { snapshotEndVersion: coveredVersion },
    {
      preserveSnapshotStructuredFields: true,
      preserveSnapshotText: true,
      ...durabilityOptions,
    },
    syncGeneration,
  );
  if (
    !persisted ||
    !isDocumentLocalWriteCurrent(state, writeGeneration, writeDoc)
  ) {
    return;
  }
  if (options.deferRemoteSync) {
    // The history tail now holds the delta; the next edit enqueues it.
    state.unsavedLocalEdits = false;
    return;
  }
  advancePendingBaseVersion(state, writeDoc);
  requestDocumentStoreSync(state);
}

function queueDocumentStructuredFieldWrite(
  state: DocumentStoreState,
  kind: Exclude<StoredDocumentKind, "note">,
  patch: DocumentStructuredFieldPatch,
  options: DocumentMutationOptions = {},
): Promise<void> {
  if (!state.doc) {
    return Promise.resolve();
  }
  try {
    if (options.stillCurrent?.() === false) return Promise.resolve();
  } catch (error) {
    reportDocumentStoreWriteFailure(state, FIELD_FAILURE_MESSAGE, error);
    return Promise.resolve();
  }
  // Guarded writes publish only after admission, never while still queued.
  if (!options.stillCurrent) {
    publishDocumentStructuredFieldSnapshot(state, kind, patch);
  }
  const write: StructuredFieldWrite = {
    kind,
    options,
    patch,
    // A guarded write may later refuse, and a deferred persist is history-only:
    // neither can stand in for another write's enqueue or be coalesced away.
    ticket:
      options.deferRemoteSync || options.stillCurrent
        ? null
        : issueLocalWriteTicket(
            state,
            Object.keys(patch).map((field): LocalWriteKey => `field:${field}`),
          ),
    writeGeneration: state.localWriteGeneration,
  };

  // See queueDocumentTextWrite: gate sync-lane text/field republish on the same
  // in-flight-write counter so structured edits get the identical protection.
  state.pendingLocalWrites += 1;
  return chainQueuedWrite(
    state,
    state.writeChain
      .catch(() => undefined)
      .then(() => writeDocumentStructuredFields(state, write))
      .catch((error: unknown) => {
        reportDocumentStoreWriteFailure(state, FIELD_FAILURE_MESSAGE, error);
      })
      // See queueDocumentTextWrite: the final current-generation write also
      // republishes any remote content that was held during the optimistic burst.
      .finally(() => {
        settleDocumentLocalWrite(state, write.writeGeneration);
      }),
  );
}

export function setDocumentText(
  state: DocumentStoreState,
  scheduleSync: () => void,
  value: string,
): Promise<void> {
  ensureDocumentStoreInitialized(state, scheduleSync);

  if (!state.initialized || !state.doc) {
    return ensureDocumentStoreReady(state, scheduleSync).then((ready) => {
      if (!ready || !state.doc || !canWriteDocument(state)) {
        return;
      }

      publishDocumentTextSnapshot(state, value);
      return queueDocumentTextWrite(state, value);
    });
  }

  if (!canWriteDocument(state)) {
    return Promise.resolve();
  }

  publishDocumentTextSnapshot(state, value);
  return queueDocumentTextWrite(state, value);
}

export function setDocumentStructuredFields(
  state: DocumentStoreState,
  scheduleSync: () => void,
  kind: Exclude<StoredDocumentKind, "note">,
  patch: DocumentStructuredFieldPatch,
  options: DocumentMutationOptions = {},
): Promise<void> {
  ensureDocumentStoreInitialized(state, scheduleSync);

  if (!state.initialized || !state.doc) {
    return ensureDocumentStoreReady(state, scheduleSync).then((ready) => {
      if (!ready || !state.doc || !canWriteDocument(state)) {
        return;
      }

      return queueDocumentStructuredFieldWrite(state, kind, patch, options);
    });
  }

  if (!canWriteDocument(state)) {
    return Promise.resolve();
  }

  return queueDocumentStructuredFieldWrite(state, kind, patch, options);
}

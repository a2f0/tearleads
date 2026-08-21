import { bytesToBase64 } from "@symcrypt/encoding";
import { encodeVersionVector, getTextValue } from "@symcrypt/loro";
import {
  projectStoredDocumentState,
  type StoredDocumentKind,
  writeStoredDocumentFields,
} from "../../../data/documents/documentKinds";
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
  advancePendingBaseVersion,
  enqueuePendingUpdate,
  pendingDeltaSinceBase,
  persistDocument,
} from "./persistence";
import {
  canWriteDocument,
  type DocumentState,
  type DocumentStoreState,
  setDocumentSnapshot,
  setReadySnapshot,
} from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

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

function queueDocumentTextWrite(
  state: DocumentStoreState,
  value: string,
): Promise<void> {
  if (!state.doc) {
    return Promise.resolve();
  }
  const writeGeneration = state.localWriteGeneration;

  // Mark a local edit as in flight SYNCHRONOUSLY, before chaining, so a sync
  // pass that runs during this burst sees pendingLocalWrites > 0 and preserves
  // the optimistic snapshot instead of regressing it to a stale doc read.
  state.pendingLocalWrites += 1;
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      if (
        state.localWriteGeneration !== writeGeneration ||
        !state.doc ||
        !canWriteDocument(state)
      ) {
        return;
      }
      const writeDoc = state.doc;
      const syncGeneration = captureDocumentStoreSyncGeneration(
        state,
        writeDoc,
      );
      if (!syncGeneration) {
        return;
      }

      if (getTextValue(writeDoc) === value) {
        return;
      }

      writeDoc.getText("text").update(value);
      const update = pendingDeltaSinceBase(state, writeDoc);
      // Captured at delta time: the enqueued row proves durable coverage up
      // to exactly this version, so this is the frontier the persist may
      // publish (a raced later edit publishes its own on its own persist).
      const coveredVersion = encodeVersionVector(writeDoc);

      await enqueuePendingUpdate(state, update);
      if (!isDocumentLocalWriteCurrent(state, writeGeneration, writeDoc)) {
        return;
      }
      const persisted = await persistDocument(
        state,
        writeDoc,
        { snapshotEndVersion: coveredVersion },
        { preserveSnapshotText: true },
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
    })
    .catch((error: unknown) => {
      console.error("Failed to persist document changes:", error);
    })
    // Always settle, even on the value-equality short-circuit or a throw, so the
    // current document's counter cannot stick non-zero. The generation guard
    // keeps a reset write from decrementing a replacement generation.
    .finally(() => {
      settleDocumentLocalWrite(state, writeGeneration);
    });
  return state.writeChain;
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

function queueDocumentStructuredFieldWrite(
  state: DocumentStoreState,
  kind: Exclude<StoredDocumentKind, "note">,
  patch: DocumentStructuredFieldPatch,
  options: DocumentMutationOptions = {},
): Promise<void> {
  if (!state.doc) {
    return Promise.resolve();
  }
  const writeGeneration = state.localWriteGeneration;

  // See queueDocumentTextWrite: gate sync-lane text/field republish on the same
  // in-flight-write counter so structured edits get the identical protection.
  state.pendingLocalWrites += 1;
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      if (
        state.localWriteGeneration !== writeGeneration ||
        !state.doc ||
        !canWriteDocument(state)
      ) {
        return;
      }
      const writeDoc = state.doc;
      const syncGeneration = captureDocumentStoreSyncGeneration(
        state,
        writeDoc,
      );
      if (!syncGeneration) {
        return;
      }

      writeStoredDocumentFields(
        writeDoc,
        kind,
        patch,
        state.runtime.infra.documentProjectors,
      );
      const update = pendingDeltaSinceBase(state, writeDoc);
      if (update.byteLength === 0) {
        return;
      }
      // Captured at delta time: the durable row written below (queue
      // dual-write or in-mutation tail append) proves coverage up to exactly
      // this version, so it is the frontier this persist may publish.
      const coveredVersion = encodeVersionVector(writeDoc);

      if (!options.deferRemoteSync) {
        await enqueuePendingUpdate(state, update);
        if (!isDocumentLocalWriteCurrent(state, writeGeneration, writeDoc)) {
          return;
        }
      }
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
          ...(options.deferRemoteSync
            ? { historyUpdates: [bytesToBase64(update)] }
            : {}),
        },
        syncGeneration,
      );
      if (
        !persisted ||
        !isDocumentLocalWriteCurrent(state, writeGeneration, writeDoc)
      ) {
        return;
      }
      if (!options.deferRemoteSync) {
        advancePendingBaseVersion(state, writeDoc);
        requestDocumentStoreSync(state);
      }
    })
    .catch((error: unknown) => {
      console.error("Failed to persist structured document changes:", error);
    })
    // See queueDocumentTextWrite: the final current-generation write also
    // republishes any remote content that was held during the optimistic burst.
    .finally(() => {
      settleDocumentLocalWrite(state, writeGeneration);
    });
  return state.writeChain;
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

      publishDocumentStructuredFieldSnapshot(state, kind, patch);
      return queueDocumentStructuredFieldWrite(state, kind, patch, options);
    });
  }

  if (!canWriteDocument(state)) {
    return Promise.resolve();
  }

  publishDocumentStructuredFieldSnapshot(state, kind, patch);
  return queueDocumentStructuredFieldWrite(state, kind, patch, options);
}

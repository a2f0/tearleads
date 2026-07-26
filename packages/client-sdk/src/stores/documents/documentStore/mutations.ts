import { bytesToBase64 } from "@tearleads/encoding";
import { getTextValue } from "@tearleads/loro";
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
    attachments: state.snapshot.attachments,
    attachmentStatusBySlotId: state.snapshot.attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId: state.snapshot.attachmentStorageKeyBySlotId,
    canAttach: state.snapshot.canAttach,
    canWrite: state.snapshot.canWrite,
    currentAuthorId: state.snapshot.currentAuthorId,
    documentId: state.snapshot.documentId,
    documentKind: state.snapshot.documentKind,
    effectiveAccessLevel: state.snapshot.effectiveAccessLevel,
    fieldValidationIssues: state.snapshot.fieldValidationIssues,
    ready: state.snapshot.ready,
    rows: state.snapshot.rows,
    structuredFields: state.snapshot.structuredFields,
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
    syncing: state.snapshot.syncing,
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

      await enqueuePendingUpdate(state, update);
      if (!isDocumentLocalWriteCurrent(state, writeGeneration, writeDoc)) {
        return;
      }
      const persisted = await persistDocument(
        state,
        writeDoc,
        {},
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
    attachments: state.snapshot.attachments,
    attachmentStatusBySlotId: state.snapshot.attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId: state.snapshot.attachmentStorageKeyBySlotId,
    canAttach: state.snapshot.canAttach,
    canWrite: state.snapshot.canWrite,
    currentAuthorId: state.snapshot.currentAuthorId,
    documentId: state.snapshot.documentId,
    documentKind: projectedState.documentKind,
    effectiveAccessLevel: state.snapshot.effectiveAccessLevel,
    fieldValidationIssues: projectedState.fieldValidationIssues,
    ready: state.snapshot.ready,
    rows: state.snapshot.rows,
    structuredFields: projectedState.structuredFields,
    text: state.snapshot.text,
    title: projectedState.title,
    syncing: state.snapshot.syncing,
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

      if (options.deferRemoteSync) {
        // A deferred write persists the snapshot AHEAD of the outgoing queue
        // (the op is re-derived by the next edit). Keep the durable-history
        // tail covering it anyway, or the next restart's full-history
        // restore would lag the shallow snapshot and fall back — parking
        // durability until an edit happens to re-derive the delta.
        await state.persistence.appendHistoryUpdates?.(
          state.runtime.infra.execSql,
          { localId: state.localId, updates: [bytesToBase64(update)] },
        );
      } else {
        await enqueuePendingUpdate(state, update);
        if (!isDocumentLocalWriteCurrent(state, writeGeneration, writeDoc)) {
          return;
        }
      }
      const persisted = await persistDocument(
        state,
        writeDoc,
        {},
        {
          preserveSnapshotStructuredFields: true,
          preserveSnapshotText: true,
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

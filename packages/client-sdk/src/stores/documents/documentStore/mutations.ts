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
  type DocumentStoreState,
  setDocumentSnapshot,
} from "./state";

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
    documentId: state.snapshot.documentId,
    documentKind: state.snapshot.documentKind,
    effectiveAccessLevel: state.snapshot.effectiveAccessLevel,
    fieldValidationIssues: state.snapshot.fieldValidationIssues,
    ready: state.snapshot.ready,
    structuredFields: state.snapshot.structuredFields,
    text: value,
    title: projectStoredDocumentState(
      {
        documentKind: state.snapshot.documentKind,
        structuredFields: state.snapshot.structuredFields,
        text: value,
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
  // Mark a local edit as in flight SYNCHRONOUSLY, before chaining, so a sync
  // pass that runs during this burst sees pendingLocalWrites > 0 and preserves
  // the optimistic snapshot instead of regressing it to a stale doc read.
  state.pendingLocalWrites += 1;
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      if (!state.doc || !canWriteDocument(state)) {
        return;
      }

      if (getTextValue(state.doc) === value) {
        return;
      }

      state.doc.getText("text").update(value);
      const update = pendingDeltaSinceBase(state, state.doc);

      await enqueuePendingUpdate(state, update);
      await persistDocument(
        state,
        state.doc,
        { text: value },
        { preserveSnapshotText: true },
      );
      advancePendingBaseVersion(state, state.doc);
      requestDocumentStoreSync(state);
    })
    .catch((error: unknown) => {
      console.error("Failed to persist document changes:", error);
    })
    // Always decrement, even on the value-equality short-circuit or a throw, so
    // the counter can never stick non-zero and permanently suppress remote text.
    // Clamp at 0: clearDocumentStoreState resets the counter to 0 while writes
    // may still be in flight, and their trailing settle must not drive it
    // negative (which would read as "quiescent" mid-edit on the next write).
    .finally(() => {
      state.pendingLocalWrites = Math.max(0, state.pendingLocalWrites - 1);
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
    },
    state.runtime.infra.documentProjectors,
  );

  setDocumentSnapshot(state, {
    attachments: state.snapshot.attachments,
    attachmentStatusBySlotId: state.snapshot.attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId: state.snapshot.attachmentStorageKeyBySlotId,
    canAttach: state.snapshot.canAttach,
    canWrite: state.snapshot.canWrite,
    documentId: state.snapshot.documentId,
    documentKind: projectedState.documentKind,
    effectiveAccessLevel: state.snapshot.effectiveAccessLevel,
    fieldValidationIssues: projectedState.fieldValidationIssues,
    ready: state.snapshot.ready,
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
  // See queueDocumentTextWrite: gate sync-lane text/field republish on the same
  // in-flight-write counter so structured edits get the identical protection.
  state.pendingLocalWrites += 1;
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      if (!state.doc || !canWriteDocument(state)) {
        return;
      }

      writeStoredDocumentFields(
        state.doc,
        kind,
        patch,
        state.runtime.infra.documentProjectors,
      );
      const update = pendingDeltaSinceBase(state, state.doc);
      if (update.byteLength === 0) {
        return;
      }

      if (!options.deferRemoteSync) {
        await enqueuePendingUpdate(state, update);
      }
      await persistDocument(
        state,
        state.doc,
        {},
        {
          preserveSnapshotStructuredFields: true,
          preserveSnapshotText: true,
        },
      );
      if (!options.deferRemoteSync) {
        advancePendingBaseVersion(state, state.doc);
        requestDocumentStoreSync(state);
      }
    })
    .catch((error: unknown) => {
      console.error("Failed to persist structured document changes:", error);
    })
    // Clamp at 0 — see queueDocumentTextWrite: a reset mid-write must not drive
    // the counter negative.
    .finally(() => {
      state.pendingLocalWrites = Math.max(0, state.pendingLocalWrites - 1);
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

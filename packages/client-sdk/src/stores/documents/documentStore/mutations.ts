import { getTextValue } from "@tearleads/loro";
import {
  projectStoredDocumentState,
  type StoredDocumentKind,
  writeStoredDocumentFields,
} from "../../../data/documents/documentKinds";
import { requestDocumentStoreSync } from "../registry";
import type { DocumentStructuredFieldPatch } from "../types";
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
import { type DocumentStoreState, setDocumentSnapshot } from "./state";

function publishDocumentTextSnapshot(
  state: DocumentStoreState,
  value: string,
): void {
  setDocumentSnapshot(state, {
    attachments: state.snapshot.attachments,
    attachmentStatusBySlotId: state.snapshot.attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId: state.snapshot.attachmentStorageKeyBySlotId,
    canAttach: state.snapshot.canAttach,
    documentId: state.snapshot.documentId,
    documentKind: state.snapshot.documentKind,
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
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      if (!state.doc) {
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
      if (!ready || !state.doc) {
        return;
      }

      publishDocumentTextSnapshot(state, value);
      return queueDocumentTextWrite(state, value);
    });
  }

  publishDocumentTextSnapshot(state, value);
  return queueDocumentTextWrite(state, value);
}

export async function setDocumentStructuredFields(
  state: DocumentStoreState,
  scheduleSync: () => void,
  kind: Exclude<StoredDocumentKind, "note">,
  patch: DocumentStructuredFieldPatch,
): Promise<void> {
  if (!(await ensureDocumentStoreReady(state, scheduleSync)) || !state.doc) {
    return;
  }

  const nextStructuredFields = { ...state.snapshot.structuredFields };
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
    documentId: state.snapshot.documentId,
    documentKind: projectedState.documentKind,
    fieldValidationIssues: projectedState.fieldValidationIssues,
    ready: state.snapshot.ready,
    structuredFields: projectedState.structuredFields,
    text: state.snapshot.text,
    title: projectedState.title,
    syncing: state.snapshot.syncing,
  });

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      if (!state.doc) {
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

      await enqueuePendingUpdate(state, update);
      await persistDocument(state, state.doc);
      advancePendingBaseVersion(state, state.doc);
      requestDocumentStoreSync(state);
    })
    .catch((error: unknown) => {
      console.error("Failed to persist structured document changes:", error);
    });
  return state.writeChain;
}

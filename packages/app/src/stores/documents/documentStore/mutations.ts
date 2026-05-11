import {
  encodeVersionVector,
  exportUpdatesSince,
  getTextValue,
} from "@tearleads/loro";
import {
  type CreditCardDocumentFields,
  type DriverLicenseDocumentFields,
  projectStoredDocumentState,
  type StoredDocumentKind,
  writeStoredDocumentFields,
} from "../../../data/documents/documentKinds";
import { requestDocumentStoreSync } from "../registry";
import { enqueuePendingUpdate, persistDocument } from "./persistence";
import { type DocumentStoreState, setDocumentSnapshot } from "./state";

export function setDocumentText(state: DocumentStoreState, value: string) {
  if (!state.doc) {
    return;
  }

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
    title: projectStoredDocumentState({
      documentKind: state.snapshot.documentKind,
      structuredFields: state.snapshot.structuredFields,
      text: value,
    }).title,
    syncing: state.snapshot.syncing,
  });

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      if (!state.doc) {
        return;
      }

      if (getTextValue(state.doc) === value) {
        return;
      }

      const previousTextVersion = encodeVersionVector(state.doc);
      state.doc.getText("text").update(value);
      const update = exportUpdatesSince(state.doc, previousTextVersion);

      await enqueuePendingUpdate(state, update);
      await persistDocument(state, state.doc, { text: value });
      requestDocumentStoreSync(state);
    })
    .catch((error: unknown) => {
      console.error("Failed to persist document changes:", error);
    });
}

export function setDocumentStructuredFields(
  state: DocumentStoreState,
  kind: Exclude<StoredDocumentKind, "note">,
  patch: Partial<DriverLicenseDocumentFields & CreditCardDocumentFields>,
) {
  if (!state.doc) {
    return;
  }

  const nextStructuredFields = {
    ...state.snapshot.structuredFields,
    ...Object.fromEntries(
      Object.entries(patch).filter((entry): entry is [string, string] => {
        const value = entry[1];
        return typeof value === "string";
      }),
    ),
  };
  const projectedState = projectStoredDocumentState({
    documentKind: kind,
    structuredFields: nextStructuredFields,
    text: state.snapshot.text,
  });

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

      const previousVersion = encodeVersionVector(state.doc);
      writeStoredDocumentFields(state.doc, kind, patch);
      const update = exportUpdatesSince(state.doc, previousVersion);
      if (update.byteLength === 0) {
        return;
      }

      await enqueuePendingUpdate(state, update);
      await persistDocument(state, state.doc);
      requestDocumentStoreSync(state);
    })
    .catch((error: unknown) => {
      console.error("Failed to persist structured document changes:", error);
    });
}

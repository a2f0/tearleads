import { mock } from "bun:test";
import type {
  DocumentRow,
  DocumentSnapshot,
  DocumentStore,
} from "@tearleads/client-sdk";

export function contactRow(
  id: string,
  fields: Record<string, string>,
): DocumentRow {
  return {
    id,
    fields,
    createdAt: "",
    createdBy: "untrusted",
    createdByPeer: null,
    updatedAt: "",
    updatedBy: "untrusted",
    updatedByPeer: null,
    fieldEditors: {},
  };
}

export function documentFixture(documentId: string | null = "contact-1") {
  let snapshot: DocumentSnapshot = {
    attachments: [],
    attachmentStatusBySlotId: {},
    attachmentStorageKeyBySlotId: {},
    canAttach: false,
    canWrite: true,
    currentAuthorId: null,
    documentId,
    documentKind: "contact",
    effectiveAccessLevel: "write",
    fieldValidationIssues: [],
    ready: true,
    rows: [
      contactRow("home-id", {
        recordType: "postalAddress",
        label: "Home",
        street: "Explorer street",
      }),
    ],
    structuredFields: { firstName: "Ada" },
    syncing: false,
    text: "",
    title: "Ada",
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<DocumentSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const methods = {
    addRow: mock(async (fields: Record<string, string>) => {
      publish({ rows: [...snapshot.rows, contactRow("added-id", fields)] });
      return "added-id";
    }),
    updateRowFields: mock(async (id: string, patch: Record<string, string>) => {
      publish({
        rows: snapshot.rows.map((entry) =>
          entry.id === id
            ? { ...entry, fields: { ...entry.fields, ...patch } }
            : entry,
        ),
      });
    }),
    removeRow: mock(async (id: string) => {
      publish({ rows: snapshot.rows.filter((entry) => entry.id !== id) });
    }),
    hasUnsavedLocalEdits: mock(() => false),
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attachFiles: () => undefined,
    removeAttachment: () => undefined,
    replaceAttachment: async () => undefined,
    requestSync: () => undefined,
    relink: async () => null,
    setStructuredFields: async () => undefined,
    setText: async () => undefined,
  };
  return { methods, publish, store: methods as unknown as DocumentStore };
}

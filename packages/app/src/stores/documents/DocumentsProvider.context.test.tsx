import { afterEach, expect, mock, test } from "bun:test";
import type { DocumentStore } from "@symcrypt/client-sdk";
import { cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import {
  DocumentContext,
  DocumentReadOnlyContext,
  useDocument,
} from "./DocumentsProvider";

afterEach(() => cleanup());

const expectedKeys = [
  "addRow",
  "attachFiles",
  "attachments",
  "attachmentStatusBySlotId",
  "attachmentStorageKeyBySlotId",
  "canAttach",
  "canWrite",
  "currentAuthorId",
  "documentId",
  "documentKind",
  "effectiveAccessLevel",
  "fieldValidationIssues",
  "ready",
  "relink",
  "removeAttachment",
  "removeRow",
  "replaceAttachment",
  "requestSync",
  "rows",
  "setStructuredFields",
  "setText",
  "structuredFields",
  "syncing",
  "text",
  "title",
  "updateRowFields",
].sort();

test("document context projects its exact surface, identities, and read-only gates", () => {
  const setText = mock(async () => undefined);
  const unused = mock(() => undefined);
  const snapshot = {
    attachments: [],
    attachmentStatusBySlotId: {},
    attachmentStorageKeyBySlotId: {},
    canAttach: true,
    canWrite: true,
    currentAuthorId: null,
    documentId: "document-1",
    documentKind: "note" as const,
    effectiveAccessLevel: "write" as const,
    fieldValidationIssues: [],
    ready: true,
    rows: [],
    structuredFields: {},
    syncing: false,
    text: "text",
    title: "title",
  };
  const store = {
    addRow: unused,
    attachFiles: unused,
    getSnapshot: () => snapshot,
    relink: unused,
    removeAttachment: unused,
    removeRow: unused,
    replaceAttachment: unused,
    requestSync: unused,
    setStructuredFields: unused,
    setText,
    subscribe: () => () => undefined,
    updateRowFields: unused,
  } as unknown as DocumentStore;
  const wrapper = (readOnly: boolean) =>
    function DocumentTestProvider({ children }: PropsWithChildren) {
      return (
        <DocumentContext.Provider value={store}>
          <DocumentReadOnlyContext.Provider value={readOnly}>
            {children}
          </DocumentReadOnlyContext.Provider>
        </DocumentContext.Provider>
      );
    };
  const view = renderHook(() => useDocument(), { wrapper: wrapper(false) });

  expect(Object.keys(view.result.current).sort()).toEqual(expectedKeys);
  expect(view.result.current.setText).toBe(setText);
  expect(view.result.current.canAttach).toBe(true);
  expect(view.result.current.canWrite).toBe(true);

  const readOnlyView = renderHook(() => useDocument(), {
    wrapper: wrapper(true),
  });
  expect(readOnlyView.result.current.canAttach).toBe(false);
  expect(readOnlyView.result.current.canWrite).toBe(false);
});

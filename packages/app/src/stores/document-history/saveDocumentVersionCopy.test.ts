import { expect, test } from "bun:test";
import type { DocumentRow, DocumentSummary } from "@tearleads/client-sdk";
import {
  type DocumentVersionCopyContent,
  saveDocumentVersionCopy,
} from "./saveDocumentVersionCopy";

type CopyInput = Parameters<typeof saveDocumentVersionCopy>[0];
type OpenInput = Parameters<CopyInput["openDocument"]>[0];

function row(id: string, fields: Record<string, string>): DocumentRow {
  return {
    createdAt: "2030-01-01T00:00:00.000Z",
    createdBy: "user-1",
    createdByPeer: "1",
    fieldEditors: {},
    fields,
    id,
    updatedAt: "2030-01-01T00:00:00.000Z",
    updatedBy: "user-1",
    updatedByPeer: "1",
  };
}

const CONTACT: DocumentVersionCopyContent = {
  documentKind: "contact",
  rows: [
    row("row-b", { recordType: "postalAddress", street: "2 Second St" }),
    row("row-a", { recordType: "postalAddress", street: "1 First St" }),
  ],
  structuredFields: { firstName: "Ada" },
  text: "",
};

const NOTE: DocumentVersionCopyContent = {
  documentKind: "note",
  rows: [],
  structuredFields: {},
  text: "an earlier version",
};

const SUMMARY: DocumentSummary = {
  containerId: "folder-1",
  documentId: null,
  documentKind: "note",
  id: "copy-1",
  title: "an earlier version",
  updatedAt: "2030-01-01T12:00:00.000Z",
};

/** A store that records how it was opened and what was asked of it. */
function harness(options: { initialized?: boolean; ready?: boolean } = {}) {
  const opened: OpenInput[] = [];
  const events: string[] = [];
  const openDocument: CopyInput["openDocument"] = (input) => {
    opened.push(input);
    return {
      ensureInitialized: async () => {
        events.push("initialized");
        return options.initialized ?? true;
      },
      getSnapshot: () => ({
        documentId: null,
        documentKind: input.initialDocumentKind,
        ready: options.ready ?? true,
        title: "from the store",
      }),
      requestSync: () => {
        events.push("sync");
      },
    };
  };
  return { events, openDocument, opened };
}

test("a copy is born in the folder with the version's content", async () => {
  const store = harness();

  const copy = await saveDocumentVersionCopy({
    containerId: "folder-1",
    content: NOTE,
    createLocalId: () => "copy-1",
    loadDocumentSummary: async (localId) => {
      store.events.push(`summary:${localId}`);
      return SUMMARY;
    },
    openDocument: store.openDocument,
  });

  expect(store.opened).toEqual([
    {
      containerId: "folder-1",
      initialDocumentKind: "note",
      initialRows: [],
      initialStructuredFields: {},
      initialText: "an earlier version",
      localId: "copy-1",
    },
  ]);
  expect(copy).toBe(SUMMARY);
  // Its sync is asked for only once it exists, and before the summary read.
  expect(store.events).toEqual(["initialized", "sync", "summary:copy-1"]);
});

test("rows keep their order and cells but not their ids or stamps", async () => {
  const store = harness();

  await saveDocumentVersionCopy({
    containerId: "folder-1",
    content: CONTACT,
    createLocalId: () => "copy-1",
    loadDocumentSummary: async () => SUMMARY,
    openDocument: store.openDocument,
  });

  expect(store.opened[0]?.initialDocumentKind).toBe("contact");
  expect(store.opened[0]?.initialStructuredFields).toEqual({
    firstName: "Ada",
  });
  expect(store.opened[0]?.initialRows).toEqual([
    { recordType: "postalAddress", street: "2 Second St" },
    { recordType: "postalAddress", street: "1 First St" },
  ]);
});

test("a note is never opened with structured fields", async () => {
  const store = harness();

  await saveDocumentVersionCopy({
    containerId: "folder-1",
    // Whatever a note version projects, a store refuses to open a note
    // with fields.
    content: { ...NOTE, structuredFields: { firstName: "Ada" } },
    createLocalId: () => "copy-1",
    loadDocumentSummary: async () => SUMMARY,
    openDocument: store.openDocument,
  });

  expect(store.opened[0]?.initialStructuredFields).toEqual({});
});

test("a copy that could not be created is null and asks for no sync", async () => {
  for (const options of [{ initialized: false }, { ready: false }]) {
    const store = harness(options);
    let summaryReads = 0;

    const copy = await saveDocumentVersionCopy({
      containerId: "folder-1",
      content: NOTE,
      createLocalId: () => "copy-1",
      loadDocumentSummary: async () => {
        summaryReads += 1;
        return SUMMARY;
      },
      openDocument: store.openDocument,
    });

    expect(copy).toBeNull();
    expect(store.events).toEqual(["initialized"]);
    expect(summaryReads).toBe(0);
  }
});

test("a created copy is reported even when its summary cannot be read", async () => {
  for (const loadDocumentSummary of [
    async () => null,
    async () => {
      throw new Error("the summary query failed");
    },
  ]) {
    const store = harness();

    const copy = await saveDocumentVersionCopy({
      containerId: "folder-1",
      content: NOTE,
      createLocalId: () => "copy-1",
      loadDocumentSummary,
      openDocument: store.openDocument,
    });

    expect(copy).toMatchObject({
      containerId: "folder-1",
      documentId: null,
      documentKind: "note",
      id: "copy-1",
      title: "from the store",
    });
    expect(store.events).toEqual(["initialized", "sync"]);
  }
});

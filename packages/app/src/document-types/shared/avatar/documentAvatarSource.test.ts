import { expect, test } from "bun:test";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import type {
  BlobStore,
  DocumentStore,
  DocumentSummary,
  Documents,
} from "@tearleads/client-sdk";
import { createDocumentAvatarSource } from "./documentAvatarSource";

const drill = {
  documentKind: "tool",
  localId: "drill-local",
  photos: { avatarFallbackIcon: WrenchIcon, slotId: "equipment-photos" },
} as const;

const store = {} as DocumentStore;

function createSource(input: {
  dbStatus?: string;
  summary: DocumentSummary | null;
}) {
  const opens: Parameters<Documents["open"]>[] = [];
  const summaryReads: Array<{ localId: string; options: unknown }> = [];
  const source = createDocumentAvatarSource({
    blobStore: {} as BlobStore,
    dbStatus: input.dbStatus ?? "ready",
    documentQueries: {
      loadDocumentSummary: async (localId, options) => {
        summaryReads.push({ localId, options });
        return input.summary;
      },
    },
    documents: {
      open: (...args) => {
        opens.push(args);
        return store;
      },
    },
  });
  return { opens, source, summaryReads };
}

const summary: DocumentSummary = {
  containerId: "garage",
  documentId: "drill-remote",
  id: "drill-local",
  title: "Drill",
  updatedAt: "2026-11-24T00:00:00.000Z",
};

test("opens a local document on demand in its own container", async () => {
  const { opens, source, summaryReads } = createSource({ summary });

  expect(await source.openDocument(drill)).toBe(store);
  expect(summaryReads).toEqual([
    { localId: "drill-local", options: { requireHydrated: true } },
  ]);
  // No initial kind: a document that vanished after the read is not born
  // with content to create remotely.
  expect(opens).toEqual([
    [
      {
        containerId: "garage",
        documentId: "drill-remote",
        localId: "drill-local",
      },
      { remoteSyncMode: "on-demand" },
    ],
  ]);
});

test("never opens a document without a local copy, so a stale row is not created", async () => {
  const { opens, source } = createSource({ summary: null });

  expect(await source.openDocument(drill)).toBeNull();
  expect(opens).toEqual([]);
});

test("leaves an orphaned document unopened", async () => {
  const { opens, source } = createSource({
    summary: { ...summary, containerId: null },
  });

  expect(await source.openDocument(drill)).toBeNull();
  expect(opens).toEqual([]);
});

test("reads nothing while the database is not ready", async () => {
  const { opens, source, summaryReads } = createSource({
    dbStatus: "locked",
    summary,
  });

  expect(await source.openDocument(drill)).toBeNull();
  expect(summaryReads).toEqual([]);
  expect(opens).toEqual([]);
});

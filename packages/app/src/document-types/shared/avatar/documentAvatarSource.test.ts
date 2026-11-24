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

function fakeStore(relinkedElsewhere?: true, loads = true) {
  return {
    ensureInitialized: async () => loads,
    getSnapshot: () => ({ relinkedElsewhere }),
  } as unknown as DocumentStore;
}

const store = fakeStore();

function createSource(input: {
  dbStatus?: string;
  open?: () => DocumentStore;
  summary: DocumentSummary | null;
}) {
  const opens: Parameters<Documents["open"]>[] = [];
  const summaryReads: Array<{ localId: string; options: unknown }> = [];
  let summary = input.summary;
  const source = createDocumentAvatarSource({
    blobStore: {} as BlobStore,
    dbStatus: input.dbStatus ?? "ready",
    documentQueries: {
      loadDocumentSummary: async (localId, options) => {
        summaryReads.push({ localId, options });
        return summary;
      },
    },
    documents: {
      open: (...args) => {
        opens.push(args);
        return input.open ? input.open() : store;
      },
    },
  });
  return {
    opens,
    setSummary: (next: DocumentSummary | null) => {
      summary = next;
    },
    source,
    summaryReads,
  };
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
  // A document that vanished after the read is not created again.
  expect(opens).toEqual([
    [
      {
        containerId: "garage",
        documentId: "drill-remote",
        localId: "drill-local",
      },
      { createIfMissing: false, remoteSyncMode: "on-demand" },
    ],
  ]);
  expect(source.openedDocument("drill-local")).toBe(store);
});

test("overlapping reads of one document open it once and keep it", async () => {
  const { opens, source, summaryReads } = createSource({ summary });

  const [first, second] = await Promise.all([
    source.openDocument(drill),
    source.openDocument(drill),
  ]);
  expect(first).toBe(store);
  expect(second).toBe(store);
  expect(await source.openDocument(drill)).toBe(store);
  expect(summaryReads).toHaveLength(1);
  expect(opens).toHaveLength(1);
});

test("a failed open is not remembered, so the next read tries again", async () => {
  let failures = 1;
  const { opens, source } = createSource({
    open: () => {
      if (failures-- > 0) throw new Error("database closed");
      return store;
    },
    summary,
  });

  expect(await source.openDocument(drill)).toBeNull();
  expect(source.openedDocument("drill-local")).toBeNull();
  expect(await source.openDocument(drill)).toBe(store);
  expect(opens).toHaveLength(2);
});

test("a document without a local copy yet is tried again later", async () => {
  const { opens, setSummary, source } = createSource({ summary: null });

  expect(await source.openDocument(drill)).toBeNull();
  setSummary(summary);
  expect(await source.openDocument(drill)).toBe(store);
  expect(opens).toHaveLength(1);
});

test("a kept store a relink displaced is dropped, and the next read reopens", async () => {
  let snapshot: { relinkedElsewhere?: true } = {};
  const displaced = {
    ensureInitialized: async () => true,
    getSnapshot: () => snapshot,
  } as unknown as DocumentStore;
  const owner = fakeStore();
  const results = [displaced, owner];
  const { opens, source } = createSource({
    open: () => results.shift() ?? owner,
    summary,
  });

  expect(await source.openDocument(drill)).toBe(displaced);
  snapshot = { relinkedElsewhere: true };
  expect(source.openedDocument("drill-local")).toBeNull();
  expect(await source.openDocument(drill)).toBe(owner);
  expect(opens).toHaveLength(2);
});

test("an open that returns a displaced view shows nothing and keeps nothing", async () => {
  const { opens, source } = createSource({
    open: () => fakeStore(true),
    summary,
  });

  expect(await source.openDocument(drill)).toBeNull();
  expect(source.openedDocument("drill-local")).toBeNull();
  expect(await source.openDocument(drill)).toBeNull();
  expect(opens).toHaveLength(2);
});

test("a store whose record was deleted while it opened is not kept", async () => {
  let loads = false;
  const { opens, source } = createSource({
    open: () => fakeStore(undefined, loads),
    summary,
  });

  expect(await source.openDocument(drill)).toBeNull();
  expect(source.openedDocument(drill.localId)).toBeNull();

  // The record comes back: the next listing tries again and keeps it.
  loads = true;
  const reopened = await source.openDocument(drill);
  expect(reopened).not.toBeNull();
  expect(source.openedDocument(drill.localId)).toBe(reopened);
  expect(opens).toHaveLength(2);
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

import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createProbeRuntime,
  settleCoordinator,
} from "../../../../../test/helpers/workflows/remoteSyncWait";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { createDomainScope } from "../../../../data/shared/domainScope";
import { disposeDomainSyncCoordinator } from "../../../../data/sync/syncCoordinator";
import { defaultDocumentsPersistence } from "../../../../workflows/documents";
import type { DocumentStoreOpenOptions, DocumentsRuntime } from "../../types";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { getOrCreateDocumentStore } from "../index";
import { createDocumentStoreState } from "../state";
import {
  ensureDeferredBirthSchema,
  offlineAttachRuntime,
} from "./deferredInitialUpdate.testFixtures";
import { ensureDocumentStoreReady } from "./index";
import {
  applyDocumentStoreCreationOptions,
  joinDocumentStoreCreation,
} from "./initialContent";

const READ_ONLY: DocumentStoreOpenOptions = {
  createIfMissing: false,
  remoteSyncMode: "on-demand",
};

// A reader opens a listed document only to read it; when the record is gone,
// the open must not create it, and a later open that may create still can.
async function withEmptyDatabase(
  name: string,
  run: (input: {
    loadRecord: () => ReturnType<
      typeof defaultDocumentsPersistence.loadDocument
    >;
    /** Runs after each query the stores make resolves, before they resume. */
    onQueryResolved: (listener: (() => void) | null) => void;
    open: (
      options?: DocumentStoreOpenOptions,
      initialText?: string,
      runtime?: DocumentsRuntime,
    ) => ReturnType<typeof getOrCreateDocumentStore>;
    runtime: DocumentsRuntime;
  }) => Promise<void>,
) {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql(name);
  let afterQuery: (() => void) | null = null;
  const execSql = ((...args: Parameters<typeof database.execSql>) =>
    database.execSql(...args).then((rows) => {
      afterQuery?.();
      return rows;
    })) as typeof database.execSql;
  const runtime = createProbeRuntime({
    execSql,
    fixture,
    syncDocument: async () => fixture.response,
  });
  const scopes = new Set([runtime.state.domainScope]);
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    await run({
      loadRecord: () =>
        defaultDocumentsPersistence.loadDocument(database.execSql, name),
      onQueryResolved: (listener) => {
        afterQuery = listener;
      },
      open: (options = {}, initialText = "", openRuntime = runtime) => {
        scopes.add(openRuntime.state.domainScope);
        return getOrCreateDocumentStore(
          openRuntime.state.domainScope,
          name,
          openRuntime,
          fixture.writerProjection.documentId,
          initialText,
          undefined,
          options,
        );
      },
      runtime,
    });
    for (const scope of scopes) await settleCoordinator(scope);
  } finally {
    for (const scope of scopes) disposeDomainSyncCoordinator(scope);
    fixture.remoteDocument.free();
    database.close();
  }
}

test("a reading open of a missing record creates nothing", async () => {
  await withEmptyDatabase("create-if-missing-refused", async (input) => {
    const store = input.open(READ_ONLY);
    expect(await store.ensureInitialized()).toBe(false);
    expect(store.getSnapshot().ready).toBe(false);
    expect(await input.loadRecord()).toBeNull();

    // Asking again does not create it either.
    expect(await store.ensureInitialized()).toBe(false);
    expect(await input.loadRecord()).toBeNull();
  });
});

test("a reading open of an existing record loads it", async () => {
  await withEmptyDatabase("create-if-missing-existing", async (input) => {
    const writer = input.open({}, "saved text");
    expect(await writer.ensureInitialized()).toBe(true);
    expect(await input.loadRecord()).not.toBeNull();

    // A reader in another domain gets its own store over the same database.
    const readerRuntime: DocumentsRuntime = {
      ...input.runtime,
      state: { ...input.runtime.state, domainScope: createDomainScope() },
    };
    const reader = input.open(READ_ONLY, "", readerRuntime);
    expect(reader).not.toBe(writer);
    expect(await reader.ensureInitialized()).toBe(true);
    expect(reader.getSnapshot().text).toBe("saved text");
  });
});

test("an open that may create joins a reading store with its own content", async () => {
  await withEmptyDatabase("create-if-missing-joined", async (input) => {
    const reader = input.open(READ_ONLY, "reader text");
    expect(await reader.ensureInitialized()).toBe(false);

    // Another reader joining asks for no record either.
    expect(input.open(READ_ONLY, "second reader")).toBe(reader);
    expect(await reader.ensureInitialized()).toBe(false);

    const creator = input.open(
      { initialRows: [{ item: "first row" }] },
      "creator text",
    );
    expect(creator).toBe(reader);
    expect(await creator.ensureInitialized()).toBe(true);
    expect(creator.getSnapshot().text).toBe("creator text");
    expect(creator.getSnapshot().rows).toMatchObject([
      { fields: { item: "first row" } },
    ]);
    expect(await input.loadRecord()).toMatchObject({ text: "creator text" });
  });
});

test("an open that may create joins a reading store mid-initialization", async () => {
  await withEmptyDatabase("create-if-missing-in-flight", async (input) => {
    const reader = input.open(READ_ONLY);
    const initialized = reader.ensureInitialized();
    input.open({}, "creator text");

    expect(await initialized).toBe(true);
    expect(reader.getSnapshot().text).toBe("creator text");
    expect(await input.loadRecord()).toMatchObject({ text: "creator text" });
  });
});

test("a creator whose content does not fit its kind cannot join a reading store", async () => {
  await withEmptyDatabase("create-if-missing-bad-join", async (input) => {
    const reader = input.open(READ_ONLY);
    // Structured fields need a structured kind; this open asks for a note.
    expect(() =>
      input.open({ initialStructuredFields: { name: "Drill" } }, "creator"),
    ).toThrow("Initial structured fields need a structured kind");

    expect(await reader.ensureInitialized()).toBe(false);
    expect(await input.loadRecord()).toBeNull();
  });
});

// How many queries a reading open makes before it refuses a missing record.
async function countRefusalQueries(): Promise<number> {
  let count = 0;
  await withEmptyDatabase("create-if-missing-count", async (input) => {
    input.onQueryResolved(() => {
      count += 1;
    });
    expect(await input.open(READ_ONLY).ensureInitialized()).toBe(false);
    input.onQueryResolved(null);
  });
  return count;
}

test("a creator that joins right after a reader's refusal still creates", async () => {
  // The reader refuses after its last query. Joining a counted number of
  // ticks after that query lands one join between the refusal and the end of
  // the reader's initialization, where the creator would wait on it.
  const lastQuery = (await countRefusalQueries()) - 1;
  for (let ticks = 0; ticks < 24; ticks += 1) {
    const name = `create-if-missing-late-${ticks}`;
    await withEmptyDatabase(name, async (input) => {
      let created: Promise<boolean> | null = null;
      const join = () => {
        created ??= input.open({}, "late creator").ensureInitialized();
        return created;
      };
      let resolved = 0;
      input.onQueryResolved(() => {
        if (resolved++ !== lastQuery) return;
        void (async () => {
          for (let tick = 0; tick < ticks; tick += 1) await Promise.resolve();
          join();
        })();
      });
      const reader = input.open(READ_ONLY);
      const refused = await reader.ensureInitialized();
      input.onQueryResolved(null);
      const ready = join();

      expect(refused).toBeBoolean();
      expect(await ready).toBe(true);
      expect(await input.loadRecord()).toMatchObject({ text: "late creator" });
    });
  }
}, 30_000);

test("an open that may create leaves a reading store that loaded alone", async () => {
  const database = await createTestExecSql("create-if-missing-loaded-join");
  try {
    await ensureDeferredBirthSchema(database.execSql);
    const runtime = offlineAttachRuntime({
      blobStore: createMemoryBlobStore(),
      canAttach: true,
      execSql: database.execSql,
    });
    const openState = (text: string) =>
      createDocumentStoreState(
        "loaded-join",
        runtime,
        defaultDocumentsPersistence,
        noopDocumentStorePersistenceEffects,
        null,
        text,
      );
    expect(
      await ensureDocumentStoreReady(openState("saved text"), () => undefined),
    ).toBe(true);
    const reader = openState("");
    applyDocumentStoreCreationOptions(reader, { createIfMissing: false });
    expect(await ensureDocumentStoreReady(reader, () => undefined)).toBe(true);

    // Like any later open of a loaded store, it shapes nothing: a deferred
    // birth here would hold the live record's sync for an attach.
    joinDocumentStoreCreation(reader, {
      initialDocumentKind: reader.initialDocumentKind,
      initialText: "creator text",
      options: { deferInitialUpdate: true },
    });
    expect(reader.deferInitialUpdate).not.toBe(true);
    expect(reader.initialText).toBe("");
    expect(reader.createIfMissing).toBe(false);
  } finally {
    database.close();
  }
});

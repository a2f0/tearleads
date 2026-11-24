import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createProbeRuntime,
  settleCoordinator,
} from "../../../../../test/helpers/workflows/remoteSyncWait";
import { createDomainScope } from "../../../../data/shared/domainScope";
import { disposeDomainSyncCoordinator } from "../../../../data/sync/syncCoordinator";
import { defaultDocumentsPersistence } from "../../../../workflows/documents";
import type { DocumentStoreOpenOptions, DocumentsRuntime } from "../../types";
import { createRemoteHistoryFixture } from "../documentStore.testFixtures";
import { getOrCreateDocumentStore } from "../index";

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
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => fixture.response,
  });
  const scopes = new Set([runtime.state.domainScope]);
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    await run({
      loadRecord: () =>
        defaultDocumentsPersistence.loadDocument(database.execSql, name),
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

    const creator = input.open({}, "creator text");
    expect(creator).toBe(reader);
    expect(await creator.ensureInitialized()).toBe(true);
    expect(creator.getSnapshot().text).toBe("creator text");
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

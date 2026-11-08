import { expect, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";
import { createDocument, getTextValue, importUpdates } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { readStoredDocumentState } from "../../../../data/documents/documentKinds";
import { createDomainScope } from "../../../../data/shared/domainScope";
import {
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  listPendingDocumentUpdates,
} from "../../../../workflows/documents";
import {
  hasPendingLocalDocumentWrites,
  registerDocumentStore,
} from "../../registry";
import type { DocumentsRuntime } from "../../types";
import { createDocumentStore } from "../index";
import {
  ensureDeferredBirthSchema,
  offlineAttachRuntime,
} from "../initialization/deferredInitialUpdate.testFixtures";

type ExecSql = DocumentsRuntime["infra"]["execSql"];

/**
 * Counts content commits and can hold the next one open, standing in for a
 * slow SQLite transaction that typing outruns.
 */
function createGatedPersistence() {
  let commits = 0;
  let pendingHold: {
    fail: boolean;
    held: PromiseWithResolvers<void>;
    release: PromiseWithResolvers<void>;
  } | null = null;
  const persistence: DocumentsPersistence = {
    ...defaultDocumentsPersistence,
    async commitDocumentMutation(...args) {
      commits += 1;
      const hold = pendingHold;
      pendingHold = null;
      if (hold) {
        hold.held.resolve();
        await hold.release.promise;
        if (hold.fail) {
          throw new Error("held commit failed");
        }
      }
      return defaultDocumentsPersistence.commitDocumentMutation(...args);
    },
  };
  return {
    persistence,
    /**
     * Holds the next commit, failing it on release when `fail` is set; resets
     * the count so it measures from here.
     */
    holdNextCommit(options: { readonly fail?: boolean } = {}) {
      commits = 0;
      const hold = {
        fail: options.fail ?? false,
        held: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>(),
      };
      pendingHold = hold;
      return { held: hold.held.promise, release: hold.release.resolve };
    },
    commitCount: () => commits,
  };
}

function openStore(input: {
  execSql: ExecSql;
  kind: string;
  localId: string;
  persistence?: DocumentsPersistence;
}) {
  return createDocumentStore(
    input.localId,
    offlineAttachRuntime({
      blobStore: createMemoryBlobStore(),
      canAttach: false,
      execSql: input.execSql,
    }),
    input.persistence ?? defaultDocumentsPersistence,
    null,
    "",
    input.kind,
  );
}

/** A freshly opened store's view of what SQLite holds for the document. */
async function reopen(execSql: ExecSql, kind: string, localId: string) {
  const reopened = openStore({ execSql, kind, localId });
  expect(await reopened.ensureInitialized()).toBe(true);
  return reopened.getSnapshot();
}

/** Decodes every queued outgoing update, as the next sync would send them. */
async function readQueued(execSql: ExecSql, localId: string) {
  const queued = await listPendingDocumentUpdates({
    execSql,
    localId,
    persistence: defaultDocumentsPersistence,
  });
  const reader = await createDocument("reader");
  importUpdates(
    reader,
    queued.map((row) => base64ToBytes(row.updateData)),
  );
  return {
    structuredFields: readStoredDocumentState(reader).structuredFields,
    text: getTextValue(reader),
  };
}

test("a setText burst behind a held commit persists the final text in at most two commits", async () => {
  const { close, execSql } = await createTestExecSql("coalesce-text-burst");
  const gated = createGatedPersistence();
  try {
    await ensureDeferredBirthSchema(execSql);
    const localId = "coalesce-text-burst";
    const store = openStore({
      execSql,
      kind: "note",
      localId,
      persistence: gated.persistence,
    });
    expect(await store.ensureInitialized()).toBe(true);
    expect(store.hasQueuedWrites()).toBe(false);

    const typed = "the quick brown fox jumps over the lazy dog";
    const hold = gated.holdNextCommit();
    const writes = [store.setText(typed.slice(0, 1))];
    await hold.held;
    for (let length = 2; length <= typed.length; length += 1) {
      writes.push(store.setText(typed.slice(0, length)));
    }
    expect(store.hasQueuedWrites()).toBe(true);
    expect(store.getSnapshot().text).toBe(typed);

    hold.release();
    await Promise.all(writes);

    expect(store.hasQueuedWrites()).toBe(false);
    expect(gated.commitCount()).toBeLessThanOrEqual(2);
    expect(store.getSnapshot().text).toBe(typed);
    expect((await reopen(execSql, "note", localId)).text).toBe(typed);
    expect((await readQueued(execSql, localId)).text).toBe(typed);
  } finally {
    close();
  }
});

test("a write that restores a failed save's text still persists that text", async () => {
  const { close, execSql } = await createTestExecSql("coalesce-failed-save");
  const gated = createGatedPersistence();
  try {
    await ensureDeferredBirthSchema(execSql);
    const localId = "coalesce-failed-save";
    const store = openStore({
      execSql,
      kind: "note",
      localId,
      persistence: gated.persistence,
    });
    expect(await store.ensureInitialized()).toBe(true);

    // "a" is applied in memory but its save fails; "ab" is superseded by the
    // final "a", which matches the unsaved in-memory text.
    const hold = gated.holdNextCommit({ fail: true });
    const writes = [store.setText("a")];
    await hold.held;
    writes.push(store.setText("ab"), store.setText("a"));
    hold.release();
    await Promise.all(writes);

    expect(store.hasQueuedWrites()).toBe(false);
    expect((await reopen(execSql, "note", localId)).text).toBe("a");
    expect((await readQueued(execSql, localId)).text).toBe("a");
  } finally {
    close();
  }
});

test("structured patches behind a held commit all persist in at most two commits", async () => {
  const { close, execSql } = await createTestExecSql("coalesce-field-burst");
  const gated = createGatedPersistence();
  try {
    await ensureDeferredBirthSchema(execSql);
    const localId = "coalesce-field-burst";
    const store = openStore({
      execSql,
      kind: "contact",
      localId,
      persistence: gated.persistence,
    });
    expect(await store.ensureInitialized()).toBe(true);

    const hold = gated.holdNextCommit();
    const writes = [store.setStructuredFields("contact", { firstName: "Ada" })];
    await hold.held;
    writes.push(
      store.setStructuredFields("contact", { lastName: "Lovelace" }),
      store.setStructuredFields("contact", { nickname: "Countess" }),
      store.setStructuredFields("contact", { firstName: "Augusta" }),
    );
    expect(store.hasQueuedWrites()).toBe(true);

    hold.release();
    await Promise.all(writes);

    const expected = {
      firstName: "Augusta",
      lastName: "Lovelace",
      nickname: "Countess",
    };
    expect(store.hasQueuedWrites()).toBe(false);
    expect(gated.commitCount()).toBeLessThanOrEqual(2);
    expect(
      (await reopen(execSql, "contact", localId)).structuredFields,
    ).toMatchObject(expected);
    expect((await readQueued(execSql, localId)).structuredFields).toMatchObject(
      expected,
    );
  } finally {
    close();
  }
});

test("interleaved text and field edits behind a held commit both persist", async () => {
  const { close, execSql } = await createTestExecSql("coalesce-interleaved");
  const gated = createGatedPersistence();
  try {
    await ensureDeferredBirthSchema(execSql);
    const localId = "coalesce-interleaved";
    const store = openStore({
      execSql,
      kind: "contact",
      localId,
      persistence: gated.persistence,
    });
    expect(await store.ensureInitialized()).toBe(true);

    const hold = gated.holdNextCommit();
    const writes = [store.setText("draft")];
    await hold.held;
    // The field writes queued after the last setText must not supersede it:
    // only a newer text write does.
    writes.push(
      store.setStructuredFields("contact", { firstName: "Ada" }),
      store.setText("draft two"),
      store.setText("final notes"),
      store.setStructuredFields("contact", { lastName: "Lovelace" }),
    );

    hold.release();
    await Promise.all(writes);

    const expected = { firstName: "Ada", lastName: "Lovelace" };
    expect(store.hasQueuedWrites()).toBe(false);
    // One in flight, then at most one commit per lane.
    expect(gated.commitCount()).toBeLessThanOrEqual(3);
    const durable = await reopen(execSql, "contact", localId);
    expect(durable.text).toBe("final notes");
    expect(durable.structuredFields).toMatchObject(expected);
    const queued = await readQueued(execSql, localId);
    expect(queued.text).toBe("final notes");
    expect(queued.structuredFields).toMatchObject(expected);
  } finally {
    close();
  }
});

test("a deferred field write never absorbs an earlier write's outgoing update", async () => {
  const { close, execSql } = await createTestExecSql("coalesce-deferred");
  const gated = createGatedPersistence();
  try {
    await ensureDeferredBirthSchema(execSql);
    const localId = "coalesce-deferred";
    const store = openStore({
      execSql,
      kind: "contact",
      localId,
      persistence: gated.persistence,
    });
    expect(await store.ensureInitialized()).toBe(true);

    const hold = gated.holdNextCommit();
    const writes = [store.setText("held")];
    await hold.held;
    writes.push(
      store.setStructuredFields("contact", { firstName: "Ada" }),
      store.setStructuredFields(
        "contact",
        { lastName: "Lovelace" },
        { deferRemoteSync: true },
      ),
    );

    hold.release();
    await Promise.all(writes);

    // The non-deferred patch still reached the outgoing queue on its own.
    const queued = await readQueued(execSql, localId);
    expect(queued.structuredFields).toMatchObject({ firstName: "Ada" });
    expect(queued.structuredFields).not.toHaveProperty("lastName");
    expect(
      (await reopen(execSql, "contact", localId)).structuredFields,
    ).toMatchObject({ firstName: "Ada", lastName: "Lovelace" });
  } finally {
    close();
  }
});

test("hasPendingLocalDocumentWrites reports queued writes per domain scope", async () => {
  const { close, execSql } = await createTestExecSql("pending-local-writes");
  const gated = createGatedPersistence();
  try {
    await ensureDeferredBirthSchema(execSql);
    const domainScope = createDomainScope();
    const otherScope = createDomainScope();
    expect(hasPendingLocalDocumentWrites(domainScope)).toBe(false);

    const localId = "pending-local-writes";
    const store = openStore({
      execSql,
      kind: "note",
      localId,
      persistence: gated.persistence,
    });
    registerDocumentStore(domainScope, localId, store, null);
    const idle = openStore({ execSql, kind: "note", localId: "idle-note" });
    registerDocumentStore(domainScope, "idle-note", idle, null);
    expect(await store.ensureInitialized()).toBe(true);
    expect(await idle.ensureInitialized()).toBe(true);
    expect(hasPendingLocalDocumentWrites(domainScope)).toBe(false);

    const hold = gated.holdNextCommit();
    const write = store.setText("unsaved");
    expect(hasPendingLocalDocumentWrites(domainScope)).toBe(true);
    await hold.held;
    expect(hasPendingLocalDocumentWrites(domainScope)).toBe(true);
    expect(hasPendingLocalDocumentWrites(otherScope)).toBe(false);

    hold.release();
    await write;
    expect(hasPendingLocalDocumentWrites(domainScope)).toBe(false);
  } finally {
    close();
  }
});

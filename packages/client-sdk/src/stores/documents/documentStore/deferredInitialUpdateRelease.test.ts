import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { hasDeferredTailScopeWork } from "../../../workflows/container-contents/pendingWrites/deferredTails";
import {
  type DocumentsPersistence,
  defaultDocumentsPersistence,
} from "../../../workflows/documents";
import { attachFilesToDocumentStore } from "./attachments";
import {
  createPdfStoreState,
  ensureDeferredBirthSchema,
  readQueuedUpdates,
} from "./deferredInitialUpdate.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";

const noopSchedule = () => undefined;
const SCOPE = (localId: string) => ({ appKind: "documents", localId });

test("a failed initialization lifts the hold over a durable birth", async () => {
  const { close, execSql } = await createTestExecSql(
    "deferred-birth-init-failure",
  );
  // Fail the reload initialization performs right after it saves the new
  // record, so the birth is durable but the store never becomes ready.
  let storeStateLoads = 0;
  let failAfterCreate = true;
  const persistence: DocumentsPersistence = Object.assign(
    Object.create(defaultDocumentsPersistence) as DocumentsPersistence,
    {
      loadDocumentStoreState: async (
        ...args: Parameters<DocumentsPersistence["loadDocumentStoreState"]>
      ) => {
        storeStateLoads += 1;
        if (failAfterCreate && storeStateLoads === 2) {
          throw new Error("database is busy");
        }
        return defaultDocumentsPersistence.loadDocumentStoreState(...args);
      },
    },
  );
  try {
    await ensureDeferredBirthSchema(execSql);
    const state = createPdfStoreState({
      blobStore: createMemoryBlobStore(),
      deferInitialUpdate: true,
      execSql,
      localId: "init-failure-pdf",
      persistence,
    });
    await expect(ensureDocumentStoreReady(state, noopSchedule)).rejects.toThrow(
      "database is busy",
    );

    // The caller may never attach now, so the store must not keep a hold
    // that would block every sync pass once it does open.
    expect(state.deferInitialUpdate).toBe(false);
    expect(
      await hasDeferredTailScopeWork(execSql, SCOPE("init-failure-pdf")),
    ).toBe(true);
    failAfterCreate = false;
    expect(await ensureDocumentStoreReady(state, noopSchedule)).toBe(true);
    expect(state.deferInitialUpdate).toBe(false);
  } finally {
    close();
  }
});

test("an empty attach on a store that never initialized only lifts the hold", async () => {
  const { close, execSql } = await createTestExecSql(
    "deferred-birth-uninitialized-attach",
  );
  try {
    await ensureDeferredBirthSchema(execSql);
    // The importer's "store not ready" path: it releases the hold on a store
    // whose initialization has not created anything yet.
    const state = createPdfStoreState({
      blobStore: createMemoryBlobStore(),
      deferInitialUpdate: true,
      execSql,
      localId: "uninitialized-pdf",
    });

    await attachFilesToDocumentStore(state, noopSchedule, []);

    // No reload into the uninitialized store, and no "removed" marking that
    // would stop it from ever opening.
    expect(state.deferInitialUpdate).toBe(false);
    expect(state.initialized).toBe(false);
    expect(state.doc).toBeNull();
    expect(await ensureDocumentStoreReady(state, noopSchedule)).toBe(true);
    expect(state.doc).not.toBeNull();
    // Opened without the hold, creation enqueues its birth as usual.
    expect(await readQueuedUpdates(state)).toMatchObject({
      documentKind: "pdf",
      rowCount: 1,
    });
  } finally {
    close();
  }
});

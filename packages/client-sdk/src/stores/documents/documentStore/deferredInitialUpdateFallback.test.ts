import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobStore } from "../../../data/blobContracts";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { getDocumentAttachments } from "../../../data/documents/documentContent";
import { hasDeferredTailScopeWork } from "../../../workflows/container-contents/pendingWrites/deferredTails";
import {
  type DocumentsPersistence,
  defaultDocumentsPersistence,
} from "../../../workflows/documents";
import { attachFilesToDocumentStore } from "./attachments";
import {
  ensureDeferredBirthSchema,
  openPdfStore,
  PDF_FIELDS,
  PDF_UPLOAD,
  readQueuedUpdates,
} from "./deferredInitialUpdate.testFixtures";
import { reloadDocumentFromDurableHistory } from "./durableDocumentReload";
import { ensureDocumentStoreReady } from "./initialization";
import { setDocumentStructuredFields } from "./mutations";
import type { DocumentStoreState } from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

const noopSchedule = () => undefined;

function blobStoreWithWrite(
  write: (state: DocumentStoreState) => Promise<void>,
  stateRef: { current: DocumentStoreState | null },
): BlobStore {
  const blobStore = createMemoryBlobStore();
  return Object.assign(Object.create(blobStore) as BlobStore, {
    writeByteSource: async (
      ...args: Parameters<BlobStore["writeByteSource"]>
    ) => {
      if (!stateRef.current) throw new Error("Store under test is not open");
      await write(stateRef.current);
      return blobStore.writeByteSource(...args);
    },
  });
}

// Runs the importer's deferred sequence (birth, deferred metadata, attach) and
// asserts the attach failure still left exactly the birth and fields queued.
async function expectBirthEnqueuedWithoutAttachment(input: {
  blobStore: BlobStore;
  canAttach?: boolean;
  name: string;
  persistence?: DocumentsPersistence;
  stateRef?: { current: DocumentStoreState | null };
}) {
  const { close, execSql } = await createTestExecSql(input.name);
  try {
    await ensureDeferredBirthSchema(execSql);
    const state = await openPdfStore({
      blobStore: input.blobStore,
      ...(input.canAttach === undefined ? {} : { canAttach: input.canAttach }),
      deferInitialUpdate: true,
      execSql,
      localId: input.name,
      ...(input.persistence ? { persistence: input.persistence } : {}),
    });
    if (input.stateRef) input.stateRef.current = state;
    await setDocumentStructuredFields(state, noopSchedule, "pdf", PDF_FIELDS, {
      deferRemoteSync: true,
    });

    await attachFilesToDocumentStore(state, noopSchedule, [PDF_UPLOAD]);

    expect(await readQueuedUpdates(state)).toEqual({
      attachmentNames: [],
      documentKind: "pdf",
      rowCount: 1,
      structuredFields: PDF_FIELDS,
    });
    expect(state.pendingAttachments).toEqual([]);
    expect(state.deferInitialUpdate).toBe(false);
    expect(await hasDeferredTailScopeWork(execSql, SCOPE(input.name))).toBe(
      false,
    );
  } finally {
    close();
  }
}

const SCOPE = (localId: string) => ({ appKind: "documents", localId });

test("a staging failure enqueues the deferred birth on its own", async () => {
  const stateRef: { current: DocumentStoreState | null } = { current: null };
  await expectBirthEnqueuedWithoutAttachment({
    blobStore: blobStoreWithWrite(async () => {
      throw new Error("blob store is full");
    }, stateRef),
    name: "deferred-birth-staging-throws",
    stateRef,
  });
});

test("staging that returns null on a replaced live doc enqueues the birth", async () => {
  const stateRef: { current: DocumentStoreState | null } = { current: null };
  await expectBirthEnqueuedWithoutAttachment({
    // Another writer reloads the store from durable history mid-stage, so the
    // attach's generation goes stale while the store itself stays live.
    blobStore: blobStoreWithWrite(async (state) => {
      const generation = captureDocumentStoreSyncGeneration(state, state.doc);
      if (!generation) throw new Error("Expected a live generation");
      await reloadDocumentFromDurableHistory({
        expectedGeneration: generation,
        preserveQueuedWritesWhenIdentityMatches: true,
        state,
      });
    }, stateRef),
    name: "deferred-birth-staging-null",
    stateRef,
  });
});

test("a refused attach persist enqueues the deferred birth", async () => {
  const persistence: DocumentsPersistence = Object.assign(
    Object.create(defaultDocumentsPersistence) as DocumentsPersistence,
    {
      commitDocumentMutation: async (
        ...args: Parameters<DocumentsPersistence["commitDocumentMutation"]>
      ) => {
        if (args[1].attachmentStaging) {
          throw new Error("attachment commit refused");
        }
        return defaultDocumentsPersistence.commitDocumentMutation(...args);
      },
    },
  );
  await expectBirthEnqueuedWithoutAttachment({
    blobStore: createMemoryBlobStore(),
    name: "deferred-birth-persist-refused",
    persistence,
  });
});

test("a store that cannot attach still enqueues the deferred birth", async () => {
  await expectBirthEnqueuedWithoutAttachment({
    blobStore: createMemoryBlobStore(),
    canAttach: false,
    name: "deferred-birth-cannot-attach",
  });
});

test("a failed rollback reloads durable history before releasing the hold", async () => {
  const stateRef: { current: DocumentStoreState | null } = { current: null };
  let liveDoc: DocumentStoreState["doc"] = null;
  await expectBirthEnqueuedWithoutAttachment({
    // A runtime swap mid-stage stales the attach's generation, so its rollback
    // reload is refused and the live doc keeps the uncommitted slot.
    blobStore: blobStoreWithWrite(async (state) => {
      const { apiClient } = state.runtime;
      state.runtime = {
        ...state.runtime,
        apiClient: Object.create(apiClient) as typeof apiClient,
      };
      liveDoc = state.doc;
      throw new Error("blob store is full");
    }, stateRef),
    name: "deferred-birth-rollback-refused",
    stateRef,
  });
  const state = stateRef.current;
  if (!state?.doc || !liveDoc) throw new Error("Expected a reloaded store");
  // The slot never reaches a pass: the live doc was replaced by durable history.
  expect(state.doc).not.toBe(liveDoc);
  expect(getDocumentAttachments(state.doc)).toEqual([]);
});

test("a transient reload failure reinitializes instead of latching the hold", async () => {
  const { close, execSql } = await createTestExecSql(
    "deferred-birth-transient-reload",
  );
  let failNextReload = false;
  const persistence: DocumentsPersistence = Object.assign(
    Object.create(defaultDocumentsPersistence) as DocumentsPersistence,
    {
      loadDocumentWithHistoryRestoreState: async (
        ...args: Parameters<
          DocumentsPersistence["loadDocumentWithHistoryRestoreState"]
        >
      ) => {
        if (failNextReload) {
          failNextReload = false;
          throw new Error("database is busy");
        }
        return defaultDocumentsPersistence.loadDocumentWithHistoryRestoreState(
          ...args,
        );
      },
    },
  );
  const stateRef: { current: DocumentStoreState | null } = { current: null };
  try {
    await ensureDeferredBirthSchema(execSql);
    const state = await openPdfStore({
      // The rollback reload is refused (stale generation) and the settlement
      // reload then fails once, so neither proves the live doc durable.
      blobStore: blobStoreWithWrite(async (current) => {
        const { apiClient } = current.runtime;
        current.runtime = {
          ...current.runtime,
          apiClient: Object.create(apiClient) as typeof apiClient,
        };
        failNextReload = true;
        throw new Error("blob store is full");
      }, stateRef),
      deferInitialUpdate: true,
      execSql,
      localId: "transient-reload-pdf",
      persistence,
    });
    stateRef.current = state;
    await setDocumentStructuredFields(state, noopSchedule, "pdf", PDF_FIELDS, {
      deferRemoteSync: true,
    });

    await attachFilesToDocumentStore(state, noopSchedule, [PDF_UPLOAD]);

    // Sync is no longer held, and the store reloads clean durable content
    // whose deferred birth the next pass will materialize.
    expect(failNextReload).toBe(false);
    expect(state.deferInitialUpdate).toBe(false);
    expect(await ensureDocumentStoreReady(state, noopSchedule)).toBe(true);
    if (!state.doc) throw new Error("Expected the store to reinitialize");
    expect(getDocumentAttachments(state.doc)).toEqual([]);
    expect(state.snapshot.structuredFields).toEqual(PDF_FIELDS);
    expect(await hasDeferredTailScopeWork(execSql, SCOPE(state.localId))).toBe(
      true,
    );
  } finally {
    close();
  }
});

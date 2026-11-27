import { expect, test } from "bun:test";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobStore } from "../../../../data/blobs/blobContracts";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { DATABASE_BUSY_RUN_LIMIT } from "../../../../data/sqlite/availability/databaseBusyRetry";
import { Tearleads } from "../../../../Tearleads";
import type { DocumentsPersistence } from "../../../../workflows/documents";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import {
  ensureDeferredBirthSchema,
  openPdfStore,
  PDF_FIELDS,
  readQueuedUpdates,
} from "../initialization/deferredInitialUpdate.testFixtures";
import { setDocumentStructuredFields } from "../mutations";
import { createDocumentStoreState } from "../state";
import { removeAttachmentFromDocumentStore } from "./attachmentRemoval";
import {
  attachFilesToDocumentStore,
  replaceAttachmentInDocumentStore,
} from "./index";

const noop = () => undefined;

const busyRefusal = () =>
  new Error("Failed query", {
    cause: new Error(DATABASE_TRANSACTION_BUSY_MESSAGE),
  });

const FILE_A = {
  bytes: new Uint8Array([1, 2, 3, 4]),
  mimeType: "application/pdf",
  name: "receipt.pdf",
};

const FILE_B = {
  bytes: new Uint8Array([9, 8, 7, 6, 5]),
  mimeType: "application/pdf",
  name: "replacement.pdf",
};

async function createAttachmentStore(input: {
  blobStore?: BlobStore;
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"];
  localId: string;
  logged?: string[];
  persistence?: DocumentsPersistence;
  sdk: Tearleads;
}) {
  await sqlDocumentsPersistence.ensureSchema(input.execSql);
  const runtime = input.sdk.documents.workflowRuntime();
  return createDocumentStoreState(
    input.localId,
    {
      ...runtime,
      crypto: {
        ...runtime.crypto,
        encapsulationKeyPair: {} as typeof runtime.crypto.encapsulationKeyPair,
      },
      infra: {
        ...runtime.infra,
        blobStore: input.blobStore ?? createMemoryBlobStore(),
        dbStatus: "ready",
        execSql: input.execSql,
      },
      state: { ...runtime.state, online: false },
      util: {
        ...runtime.util,
        log: (message) => input.logged?.push(message),
      },
    },
    input.persistence ?? sqlDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    null,
  );
}

test("attach retries busy refusals at readiness, blob staging, and atomic SQLite commit", async () => {
  const database = await createTestExecSql("attach-busy-each-step");
  const reported: unknown[] = [];
  const logged: string[] = [];
  const sdk = new Tearleads({
    logger: { log: () => undefined, logError: (_m, e) => reported.push(e) },
  });
  try {
    const innerBlobStore = createMemoryBlobStore();
    let blobWriteCalls = 0;
    const blobStore: BlobStore = Object.assign(
      Object.create(innerBlobStore) as BlobStore,
      {
        writeByteSource: async (
          ...args: Parameters<BlobStore["writeByteSource"]>
        ) => {
          blobWriteCalls += 1;
          if (blobWriteCalls === 1) throw busyRefusal();
          return innerBlobStore.writeByteSource(...args);
        },
      },
    );

    let initRefusals = 1;
    let commitRefusals = 2;
    const persistence: DocumentsPersistence = {
      ...sqlDocumentsPersistence,
      async loadDocumentStoreState(...args) {
        if (initRefusals > 0) {
          initRefusals -= 1;
          throw busyRefusal();
        }
        return sqlDocumentsPersistence.loadDocumentStoreState(...args);
      },
      async commitDocumentMutation(...args) {
        if (args[1].attachmentStaging && commitRefusals > 0) {
          commitRefusals -= 1;
          throw busyRefusal();
        }
        return sqlDocumentsPersistence.commitDocumentMutation(...args);
      },
    };

    const state = await createAttachmentStore({
      blobStore,
      execSql: database.execSql,
      localId: "attach-busy-doc",
      logged,
      persistence,
      sdk,
    });

    await attachFilesToDocumentStore(state, noop, [FILE_A]);

    expect(reported).toEqual([]);
    // Staging retried once on busy; SQLite commit retried without re-staging.
    expect(blobWriteCalls).toBe(2);
    expect(state.snapshot.attachments).toHaveLength(1);
    expect(state.snapshot.attachments[0]?.name).toBe("receipt.pdf");
    expect(state.pendingAttachments).toHaveLength(1);
    const storageKey = state.pendingAttachments[0]?.storageKey;
    expect(storageKey).toBeString();
    if (!storageKey) throw new Error("Expected staged storageKey");
    expect(await innerBlobStore.readBytes(storageKey)).toEqual(FILE_A.bytes);

    const durablePending = await sqlDocumentsPersistence.listPendingAttachments(
      database.execSql,
      "attach-busy-doc",
    );
    expect(durablePending.map((row) => row.storageKey)).toEqual([storageKey]);
  } finally {
    sdk.dispose();
    database.close();
  }
});

test("replace and remove retry busy refusals cleanly without reporting errors", async () => {
  const database = await createTestExecSql("replace-remove-busy");
  const reported: unknown[] = [];
  const sdk = new Tearleads({
    logger: { log: () => undefined, logError: (_m, e) => reported.push(e) },
  });
  try {
    const innerBlobStore = createMemoryBlobStore();
    let failNextBlobWrite = false;
    const blobStore: BlobStore = Object.assign(
      Object.create(innerBlobStore) as BlobStore,
      {
        writeByteSource: async (
          ...args: Parameters<BlobStore["writeByteSource"]>
        ) => {
          if (failNextBlobWrite) {
            failNextBlobWrite = false;
            throw busyRefusal();
          }
          return innerBlobStore.writeByteSource(...args);
        },
      },
    );

    let failStagingCommits = 0;
    let failRemovalCommits = 0;
    const persistence: DocumentsPersistence = {
      ...sqlDocumentsPersistence,
      async commitDocumentMutation(...args) {
        if (args[1].attachmentStaging && failStagingCommits > 0) {
          failStagingCommits -= 1;
          throw busyRefusal();
        }
        if (args[1].attachmentRemoval && failRemovalCommits > 0) {
          failRemovalCommits -= 1;
          throw busyRefusal();
        }
        return sqlDocumentsPersistence.commitDocumentMutation(...args);
      },
    };

    const state = await createAttachmentStore({
      blobStore,
      execSql: database.execSql,
      localId: "replace-remove-doc",
      persistence,
      sdk,
    });

    await attachFilesToDocumentStore(state, noop, [FILE_A]);
    const slotId = state.snapshot.attachments[0]?.slotId;
    if (!slotId) throw new Error("Expected initial attachment slot");

    failNextBlobWrite = true;
    failStagingCommits = 2;
    await replaceAttachmentInDocumentStore(state, noop, slotId, FILE_B);
    expect(state.snapshot.attachments).toHaveLength(1);
    expect(state.snapshot.attachments[0]?.name).toBe("replacement.pdf");
    const replacedKey = state.attachmentStorageKeyBySlotId[slotId];
    if (!replacedKey) throw new Error("Expected replaced storageKey");
    expect(await innerBlobStore.readBytes(replacedKey)).toEqual(FILE_B.bytes);

    failRemovalCommits = 2;
    await removeAttachmentFromDocumentStore(state, noop, slotId);
    expect(state.snapshot.attachments).toEqual([]);
    expect(state.pendingAttachments).toEqual([]);
    expect(reported).toEqual([]);
  } finally {
    sdk.dispose();
    database.close();
  }
});

test("exhausted busy attach and remove roll back staged bytes and snapshot and report loss", async () => {
  const database = await createTestExecSql("attach-remove-busy-exhausted");
  const reported: unknown[] = [];
  const sdk = new Tearleads({
    logger: { log: () => undefined, logError: (_m, e) => reported.push(e) },
  });
  try {
    const innerBlobStore = createMemoryBlobStore();
    const writtenKeys: string[] = [];
    const blobStore: BlobStore = Object.assign(
      Object.create(innerBlobStore) as BlobStore,
      {
        writeByteSource: async (
          storageKey: string,
          source: Parameters<BlobStore["writeByteSource"]>[1],
          assertCurrent?: Parameters<BlobStore["writeByteSource"]>[2],
        ) => {
          writtenKeys.push(storageKey);
          return innerBlobStore.writeByteSource(
            storageKey,
            source,
            assertCurrent,
          );
        },
      },
    );

    let failAllStagingCommits = true;
    let failAllRemovalCommits = false;
    let stagingAttempts = 0;
    let removalAttempts = 0;
    const persistence: DocumentsPersistence = {
      ...sqlDocumentsPersistence,
      async commitDocumentMutation(...args) {
        if (args[1].attachmentStaging && failAllStagingCommits) {
          stagingAttempts += 1;
          throw busyRefusal();
        }
        if (args[1].attachmentRemoval && failAllRemovalCommits) {
          removalAttempts += 1;
          throw busyRefusal();
        }
        return sqlDocumentsPersistence.commitDocumentMutation(...args);
      },
    };

    const state = await createAttachmentStore({
      blobStore,
      execSql: database.execSql,
      localId: "exhausted-attach-doc",
      persistence,
      sdk,
    });

    await attachFilesToDocumentStore(state, noop, [FILE_A]);
    expect(stagingAttempts).toBe(DATABASE_BUSY_RUN_LIMIT);
    expect(state.snapshot.attachments).toEqual([]);
    expect(state.pendingAttachments).toEqual([]);
    expect(writtenKeys).toHaveLength(1);
    expect(await innerBlobStore.readBytes(writtenKeys[0] ?? "")).toBeNull();
    expect(reported).toHaveLength(1);

    // Attach cleanly once busy clears, then exhaust retries on removal.
    failAllStagingCommits = false;
    await attachFilesToDocumentStore(state, noop, [FILE_A]);
    const slotId = state.snapshot.attachments[0]?.slotId;
    if (!slotId) throw new Error("Expected attached slot");

    failAllRemovalCommits = true;
    await removeAttachmentFromDocumentStore(state, noop, slotId);
    expect(removalAttempts).toBe(DATABASE_BUSY_RUN_LIMIT);
    expect(state.snapshot.attachments).toHaveLength(1);
    expect(state.snapshot.attachments[0]?.slotId).toBe(slotId);
    expect(reported).toHaveLength(1);
  } finally {
    sdk.dispose();
    database.close();
  }
});

test("deferred birth settlement retries busy refusals when releasing the hold", async () => {
  const { close, execSql } = await createTestExecSql("deferred-birth-busy");
  try {
    await ensureDeferredBirthSchema(execSql);
    let busyDeferredTail = true;
    const persistence: DocumentsPersistence = {
      ...sqlDocumentsPersistence,
      async commitDocumentMutation(...args) {
        if (args[1].pendingUpdate && busyDeferredTail) {
          busyDeferredTail = false;
          throw busyRefusal();
        }
        return sqlDocumentsPersistence.commitDocumentMutation(...args);
      },
    };
    const state = await openPdfStore({
      blobStore: createMemoryBlobStore(),
      deferInitialUpdate: true,
      execSql,
      localId: "deferred-birth-busy",
      persistence,
    });
    await setDocumentStructuredFields(state, noop, "pdf", PDF_FIELDS, {
      deferRemoteSync: true,
    });

    await attachFilesToDocumentStore(state, noop, []);

    expect(state.deferInitialUpdate).toBe(false);
    expect(await readQueuedUpdates(state)).toEqual({
      attachmentNames: [],
      documentKind: "pdf",
      rowCount: 1,
      structuredFields: PDF_FIELDS,
    });
  } finally {
    close();
  }
});

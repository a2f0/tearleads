import { base64ToBytes } from "@tearleads/encoding";
import { createDocument, importUpdates } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMemoryBlobStore } from "../../src/data/blobs/memoryBlobStore";
import { readStoredDocumentState } from "../../src/data/documents/documentKinds";
import { listDocumentRows } from "../../src/data/documents/documentRowList";
import { createDocumentStore } from "../../src/stores/documents/documentStore/index";
import {
  ensureDeferredBirthSchema,
  offlineAttachRuntime,
} from "../../src/stores/documents/documentStore/initialization/deferredInitialUpdate.testFixtures";
import type { DocumentsRuntime } from "../../src/stores/documents/types";
import {
  type DocumentsPersistence,
  defaultDocumentsPersistence,
} from "../../src/workflows/documents";

function createHold(fail = false) {
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  return {
    entered: entered.promise,
    release: released.resolve,
    async wait() {
      entered.resolve();
      await released.promise;
      if (fail) throw new Error("admission fixture commit failed");
    },
  };
}

/** Holds real persistence calls; the SDK's own write chain remains intact. */
export async function createMutationAdmissionFixture(localId: string) {
  const database = await createTestExecSql(localId);
  await ensureDeferredBirthSchema(database.execSql);
  const errors: unknown[] = [];
  const baseRuntime = offlineAttachRuntime({
    blobStore: createMemoryBlobStore(),
    canAttach: false,
    execSql: database.execSql,
  });
  const runtime: DocumentsRuntime = {
    ...baseRuntime,
    util: {
      ...baseRuntime.util,
      logError: (_message, error) => {
        errors.push(error);
      },
    },
  };
  let nextCommit: ReturnType<typeof createHold> | undefined;
  let nextLoad: ReturnType<typeof createHold> | undefined;
  const holds: ReturnType<typeof createHold>[] = [];
  const persistence: DocumentsPersistence = {
    ...defaultDocumentsPersistence,
    async commitDocumentMutation(...args) {
      const hold = nextCommit;
      nextCommit = undefined;
      await hold?.wait();
      return defaultDocumentsPersistence.commitDocumentMutation(...args);
    },
    async loadDocumentStoreState(...args) {
      const hold = nextLoad;
      nextLoad = undefined;
      await hold?.wait();
      return defaultDocumentsPersistence.loadDocumentStoreState(...args);
    },
  };
  const open = (adapter = persistence) =>
    createDocumentStore(localId, runtime, adapter, null, "", "contact");
  const store = open();
  return {
    store,
    open,
    errors,
    async reopen() {
      const reopened = open(defaultDocumentsPersistence);
      if (!(await reopened.ensureInitialized()))
        throw new Error("reopen failed");
      return reopened.getSnapshot();
    },
    async queued() {
      return defaultDocumentsPersistence.listPendingUpdates(
        database.execSql,
        localId,
      );
    },
    async readOutgoing() {
      const rows = await defaultDocumentsPersistence.listPendingUpdates(
        database.execSql,
        localId,
      );
      const reader = await createDocument("admission-reader");
      importUpdates(
        reader,
        rows.map((row) => base64ToBytes(row.updateData)),
      );
      return {
        rows: listDocumentRows(reader),
        structuredFields: readStoredDocumentState(reader).structuredFields,
      };
    },
    holdCommit(fail = false) {
      const hold = createHold(fail);
      holds.push(hold);
      nextCommit = hold;
      return hold;
    },
    holdReadiness() {
      const hold = createHold();
      holds.push(hold);
      nextLoad = hold;
      return hold;
    },
    close() {
      for (const hold of holds) hold.release();
      database.close();
    },
  };
}

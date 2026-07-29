import { expect, test } from "bun:test";
import type {
  DocumentRecord,
  DocumentsPersistence,
  PendingAttachmentRecord,
} from "@tearleads/client-sdk";
import { createDocument } from "@tearleads/loro";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { runSerializedSqlMutation } from "../../data/sqlite/sqlSchema";
import { createDocumentProjectorRegistry } from "../../documents";
import {
  deletePersistedDocument,
  loadPersistedDocumentStoreState,
  persistDocumentState,
  savePendingDocumentAttachment,
} from "./index";

function createNoopExecSql(): ExecSql {
  return (async () => []) as ExecSql;
}

test("loadPersistedDocumentStoreState uses the provided executor", async () => {
  const execSql = createNoopExecSql();
  const calls: string[] = [];
  const persistence = {
    ensureSchema: async (nextExecSql: ExecSql) => {
      expect(nextExecSql).toBe(execSql);
      calls.push("ensureSchema");
    },
    loadDocument: async (nextExecSql: ExecSql, localId: string) => {
      expect(nextExecSql).toBe(execSql);
      expect(localId).toBe("local-document");
      calls.push("loadDocument");
      return null;
    },
    listPendingAttachments: async (nextExecSql: ExecSql, localId: string) => {
      expect(nextExecSql).toBe(execSql);
      expect(localId).toBe("local-document");
      calls.push("listPendingAttachments");
      return [];
    },
    listLocalAttachments: async (nextExecSql: ExecSql, localId: string) => {
      expect(nextExecSql).toBe(execSql);
      expect(localId).toBe("local-document");
      calls.push("listLocalAttachments");
      return [];
    },
  } as unknown as DocumentsPersistence;

  const loaded = await loadPersistedDocumentStoreState({
    execSql,
    localId: "local-document",
    persistence,
  });

  expect(calls).toEqual([
    "ensureSchema",
    "loadDocument",
    "listPendingAttachments",
    "listLocalAttachments",
  ]);
  expect(loaded).toEqual({
    document: null,
    localAttachments: [],
    pendingAttachments: [],
  });
});

test("savePendingDocumentAttachment uses the provided executor", async () => {
  const execSql = createNoopExecSql();
  const attachment: PendingAttachmentRecord = {
    byteLength: 12,
    localId: "local-document",
    mimeType: "text/plain",
    name: "attachment.txt",
    slotId: "slot",
    storageKey: "storage",
  };
  const savedAttachments: PendingAttachmentRecord[] = [];
  const persistence = {
    savePendingAttachment: async (
      nextExecSql: ExecSql,
      nextAttachment: PendingAttachmentRecord,
    ) => {
      expect(nextExecSql).toBe(execSql);
      savedAttachments.push(nextAttachment);
    },
  } as unknown as DocumentsPersistence;

  await savePendingDocumentAttachment({
    attachment,
    execSql,
    persistence,
  });

  expect(savedAttachments).toEqual([attachment]);
});

test("persistDocumentState ensures client projection tables once per executor and registry", async () => {
  const statements: string[] = [];
  const execSql: ExecSql = (async (sql: string) => {
    statements.push(sql);
    return [];
  }) as ExecSql;
  let currentRecord: DocumentRecord | null = null;
  const persistence = {
    // No projection row exists for this localId, so the container-unmanaged
    // persist falls back to the current record / runtime container as before.
    loadDocumentContainer: async () => undefined,
    saveDocument: async (_execSql: ExecSql, record: DocumentRecord) => {
      currentRecord = record;
      return "2026-05-24T00:00:00.000Z";
    },
  } as unknown as DocumentsPersistence;
  const documentProjectors = createDocumentProjectorRegistry([
    {
      kind: "note",
      clientProjection: {
        tables: [
          {
            name: "note_projection",
            createSql:
              'CREATE TABLE IF NOT EXISTS "note_projection" ("local_id" TEXT PRIMARY KEY)',
            indexes: [
              'CREATE INDEX IF NOT EXISTS "note_projection_local_idx" ON "note_projection" ("local_id")',
            ],
          },
        ],
        save: async ({ execSql: projectionExecSql }) => {
          await projectionExecSql(
            'INSERT INTO "note_projection" DEFAULT VALUES',
          );
        },
      },
    },
  ]);
  const currentDoc = await createDocument("projection-schema-cache");
  await persistDocumentState({
    currentDoc,
    currentRecord,
    documentProjectors,
    execSql,
    localId: "local-document",
    persistence,
  });
  await persistDocumentState({
    currentDoc,
    currentRecord,
    documentProjectors,
    execSql,
    localId: "local-document",
    persistence,
  });

  expect(
    statements.filter((statement) =>
      statement.includes('CREATE TABLE IF NOT EXISTS "note_projection"'),
    ),
  ).toHaveLength(1);
  expect(
    statements.filter((statement) =>
      statement.includes(
        'CREATE INDEX IF NOT EXISTS "note_projection_local_idx"',
      ),
    ),
  ).toHaveLength(1);
});

test("guarded persistence aborts before claiming or reading the durable row", async () => {
  const currentDoc = await createDocument("guarded-persist-abort");
  let loads = 0;
  let saves = 0;
  const persistence = {
    loadDocumentContainer: async () => {
      loads += 1;
      return undefined;
    },
    saveDocument: async () => {
      saves += 1;
      return "2026-07-24T00:00:00.000Z";
    },
  } as unknown as DocumentsPersistence;

  const result = await persistDocumentState({
    canStartDurableMutation: () => false,
    currentDoc,
    currentRecord: null,
    documentProjectors: createDocumentProjectorRegistry([]),
    execSql: createNoopExecSql(),
    localId: "local-document",
    persistence,
  });

  expect(result).toBeNull();
  expect(loads).toBe(0);
  expect(saves).toBe(0);
});

test("a persist without an explicit frontier retains the stored one", async () => {
  // The live document is AHEAD of the stored frontier (an in-flight edit
  // whose durable row has not landed). A metadata-only persist must not
  // publish the live document's version — that would claim coverage for
  // content no durable row holds yet.
  const currentDoc = await createDocument("retained-frontier");
  currentDoc.getText("text").update("in-flight edit");
  currentDoc.commit();
  const currentRecord = {
    id: "local-document",
    accessEpoch: 1,
    containerId: null,
    documentId: "remote-1",
    snapshotEndVersion: "stored-frontier",
    text: "",
  } as DocumentRecord;
  const savedFrontiers: string[] = [];
  const persistence = {
    loadDocumentContainer: async () => undefined,
    saveDocument: async (
      _execSql: ExecSql,
      record: { snapshotEndVersion: string },
    ) => {
      savedFrontiers.push(record.snapshotEndVersion);
      return "2026-07-27T00:00:00.000Z";
    },
  } as unknown as DocumentsPersistence;

  await persistDocumentState({
    currentDoc,
    currentRecord,
    documentProjectors: createDocumentProjectorRegistry([]),
    execSql: createNoopExecSql(),
    localId: "local-document",
    patch: { lastCommitLsn: "42" },
    persistence,
  });

  expect(savedFrontiers).toEqual(["stored-frontier"]);
});

test("guarded deletion aborts before reading or deleting the durable row", async () => {
  let loads = 0;
  let deletes = 0;
  const persistence = {
    deleteDocument: async () => {
      deletes += 1;
    },
    ensureSchema: async () => undefined,
    loadDocument: async () => {
      loads += 1;
      return null;
    },
  } as unknown as DocumentsPersistence;

  const deleted = await deletePersistedDocument({
    canStartDurableMutation: () => false,
    documentProjectors: createDocumentProjectorRegistry([]),
    execSql: createNoopExecSql(),
    localId: "local-document",
    persistence,
  });

  expect(deleted).toBe(false);
  expect(loads).toBe(0);
  expect(deletes).toBe(0);
});

// The guard's answer can go stale while the deletion waits behind another
// serialized mutation (a store reset, a replacement generation's persist).
// It must be re-asked inside the claimed mutation, or the delete wipes rows
// the newer generation just wrote.
test("a guard that goes stale while queued refuses the deletion", async () => {
  const execSql = createNoopExecSql();
  let loads = 0;
  let deletes = 0;
  const persistence = {
    deleteDocument: async () => {
      deletes += 1;
    },
    ensureSchema: async () => undefined,
    loadDocument: async () => {
      loads += 1;
      return null;
    },
  } as unknown as DocumentsPersistence;

  let canDelete = true;
  let releaseHeldMutation = () => {};
  const mutationHeld = new Promise<void>((resolve) => {
    releaseHeldMutation = resolve;
  });
  // The "concurrent teardown": holds the executor's mutex while the deletion
  // queues behind it.
  const heldMutation = runSerializedSqlMutation(execSql, async () => {
    await mutationHeld;
  });
  const queuedDeletion = deletePersistedDocument({
    canStartDurableMutation: () => canDelete,
    documentProjectors: createDocumentProjectorRegistry([]),
    execSql,
    localId: "local-document",
    persistence,
  });
  // A macrotask drains every pending continuation: the deletion's schema
  // setup completes and it parks at the held mutex — the only thing it can
  // still be waiting on — BEFORE the guard flips. A pre-claim guard has
  // provably already run (and passed) by this point.
  await new Promise((resolve) => setTimeout(resolve, 0));
  canDelete = false;
  releaseHeldMutation();
  await heldMutation;

  expect(await queuedDeletion).toBe(false);
  expect(loads).toBe(0);
  expect(deletes).toBe(0);
});

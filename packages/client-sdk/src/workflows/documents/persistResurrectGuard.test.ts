import { expect, test } from "bun:test";
import { createDocument } from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import {
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import { createDocumentProjectorRegistry } from "../../documents";
import { saveDocumentRecord } from "../../stores/documents/documentStore/persistence";
import { createDocumentStoreState } from "../../stores/documents/documentStore/state";
import type { DocumentsRuntime } from "../../stores/documents/types";
import { persistDocumentState } from "./persistence";

const racingContactProjectionTable = {
  createSql:
    'CREATE TABLE IF NOT EXISTS "test_contact_projection" ("local_id" TEXT PRIMARY KEY)',
  indexes: [],
  name: "test_contact_projection",
};

// A persist that expected to UPDATE must not resurrect a document another
// subsystem deleted while the persist was in flight (the contacts
// duplicate-self cleanup racing a deferred write): the in-mutation existence
// check refuses the whole persist, history appends included.
test("an update persist refuses to resurrect a deleted row", async () => {
  const { close, execSql } = await createTestExecSql("persist-resurrect");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await ensureSqlTables(execSql, [racingContactProjectionTable]);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "victim",
      containerId: "container",
      documentId: "victim-remote",
      documentKind: "contact",
      text: "before",
      snapshotEndVersion: "v1",
      accessEpoch: 1,
    });
    await execSql(
      'INSERT INTO "test_contact_projection" ("local_id") VALUES (?)',
      ["victim"],
    );
    const documentProjectors = createDocumentProjectorRegistry([
      {
        kind: "contact",
        clientProjection: {
          delete: async ({ execSql: projectionExecSql, localId }) => {
            await projectionExecSql(
              'DELETE FROM "test_contact_projection" WHERE "local_id" = ?',
              [localId],
            );
          },
          save: async () => undefined,
          tables: [racingContactProjectionTable],
        },
      },
    ]);
    const currentRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      "victim",
    );
    if (!currentRecord) {
      throw new Error("expected seeded document");
    }

    const doc = await createDocument("persist-resurrect");
    doc.getText("text").update("racing edit");
    doc.commit();

    // The "concurrent teardown": holds the executor's mutex and deletes the
    // row INSIDE it, while the persist queues behind. A pre-lock existence
    // check would have seen the row alive; only the in-mutation check
    // observes the deletion.
    let releaseHeldMutation = () => {};
    const mutationHeld = new Promise<void>((resolve) => {
      releaseHeldMutation = resolve;
    });
    const heldMutation = runSerializedSqlMutation(execSql, async (locked) => {
      await mutationHeld;
      // The real deletion path (documents row AND projection), running
      // inside the held mutation via serialized-exec re-entry.
      await sqlDocumentsPersistence.deleteDocument(locked, "victim");
    });
    // This side write queues AFTER deletion but BEFORE the guarded persist. It
    // models the edit flows whose durable queue/history append is a separate
    // mutation from their record write.
    const queuedSideWrite = sqlDocumentsPersistence.enqueuePendingUpdate(
      execSql,
      {
        localId: "victim",
        partialEndVersionVector: "end",
        partialStartVersionVector: "start",
        sourceVersionVector: null,
        updateData: "b3JwaGFuZWQtc2lkZS13cml0ZQ==",
      },
    );
    const queuedAttachmentWrite = sqlDocumentsPersistence.savePendingAttachment(
      execSql,
      {
        byteLength: 1,
        localId: "victim",
        mimeType: "text/plain",
        name: "racing.txt",
        slotId: "racing-slot",
        storageKey: "racing-storage",
      },
    );
    const queuedLocalAttachmentWrite =
      sqlDocumentsPersistence.saveLocalAttachment(execSql, {
        blobId: "racing-blob",
        byteLength: 1,
        detachedAt: null,
        localId: "victim",
        mimeType: "text/plain",
        slotId: "racing-local-slot",
        storageKey: "racing-local-storage",
      });
    const queuedPersist = persistDocumentState({
      currentDoc: doc,
      currentRecord,
      documentProjectors,
      execSql,
      historyUpdates: ["cmFjaW5nLXRhaWw="],
      localId: "victim",
      persistence: sqlDocumentsPersistence,
    });
    // A macrotask drains every pending continuation: the persist parks at
    // the held mutex — the row still alive — before the deletion lands.
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseHeldMutation();
    await heldMutation;
    await queuedSideWrite;
    await queuedAttachmentWrite;
    await queuedLocalAttachmentWrite;

    expect(await queuedPersist).toBeNull();
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "victim"),
    ).toBeNull();
    expect(
      await execSql('SELECT "local_id" FROM "test_contact_projection"'),
    ).toEqual([]);
    const tails = await execSql(
      "SELECT id FROM document_history_updates WHERE local_id = 'victim'",
    );
    expect(tails).toEqual([]);
    expect(
      await sqlDocumentsPersistence.listPendingUpdates(execSql, "victim"),
    ).toEqual([]);
    expect(
      await execSql(
        "SELECT storage_key FROM document_orphan_blob_reclaims ORDER BY storage_key",
      ),
    ).toEqual([
      { storage_key: "racing-local-storage" },
      { storage_key: "racing-storage" },
    ]);
  } finally {
    close();
  }
});

// The create path (no current record) is untouched: persisting a brand-new
// document still inserts.
test("a create persist still inserts a new row", async () => {
  const { close, execSql } = await createTestExecSql("persist-create-ok");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const doc = await createDocument("persist-create");
    doc.getText("text").update("fresh");
    doc.commit();
    const persisted = await persistDocumentState({
      currentDoc: doc,
      currentRecord: null,
      documentProjectors: createDocumentProjectorRegistry([]),
      execSql,
      localId: "fresh-doc",
      persistence: sqlDocumentsPersistence,
    });

    expect(persisted).not.toBeNull();
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "fresh-doc"),
    ).not.toBeNull();
  } finally {
    close();
  }
});

test("the guard uses canonical existence instead of custom load semantics", async () => {
  const { close, execSql } = await createTestExecSql(
    "persist-custom-existence",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "custom",
      containerId: null,
      documentId: null,
      text: "before",
      snapshotEndVersion: "v1",
      accessEpoch: 1,
    });
    const currentRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      "custom",
    );
    if (!currentRecord) {
      throw new Error("expected seeded document");
    }
    const doc = await createDocument("persist-custom-existence");
    doc.getText("text").update("after");
    doc.commit();
    let deleteCalls = 0;
    const persistence = {
      ...sqlDocumentsPersistence,
      deleteDocument: async () => {
        deleteCalls += 1;
      },
      hasDocument: async () => true,
      loadDocument: async () => null,
    };

    expect(
      await persistDocumentState({
        currentDoc: doc,
        currentRecord,
        documentProjectors: createDocumentProjectorRegistry([]),
        execSql,
        localId: "custom",
        persistence,
      }),
    ).not.toBeNull();
    expect(deleteCalls).toBe(0);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "custom"),
    ).toMatchObject({ text: "after" });
  } finally {
    close();
  }
});

// Store-level: a persist refused by the resurrect guard clears the zombie
// store, so callers that ignore the persist result (attachment settles, row
// writes, history rebuilds) stop advancing state or scheduling sync against
// a document another subsystem deleted.
test("a refused persist marks the store removed", async () => {
  const { close, execSql } = await createTestExecSql("persist-store-removed");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "victim",
      containerId: "container",
      documentId: "victim-remote",
      text: "before",
      snapshotEndVersion: "v1",
      accessEpoch: 1,
    });
    const currentRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      "victim",
    );
    if (!currentRecord) {
      throw new Error("expected seeded document");
    }
    const runtime = {
      auth: { isAuthenticated: true, organizationId: "org", userId: "user" },
      crypto: {},
      resolveTrustedUserIdentity: async () => null,
      infra: {
        dbStatus: "ready",
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql,
      },
      state: {
        containerId: "container",
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: { log: () => undefined },
    } as unknown as DocumentsRuntime;
    const state = createDocumentStoreState(
      "victim",
      runtime,
      sqlDocumentsPersistence,
      { emitPersistedDocument: () => {}, registerDocumentIdentity: () => {} },
      "victim-remote",
    );
    const doc = await createDocument("persist-store-removed");
    doc.getText("text").update("racing edit");
    doc.commit();
    state.doc = doc;
    state.record = currentRecord;

    let releaseHeldMutation = () => {};
    const mutationHeld = new Promise<void>((resolve) => {
      releaseHeldMutation = resolve;
    });
    const heldMutation = runSerializedSqlMutation(execSql, async (locked) => {
      await mutationHeld;
      await sqlDocumentsPersistence.deleteDocument(locked, "victim");
    });
    const queuedSave = saveDocumentRecord(state, doc);
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseHeldMutation();
    await heldMutation;

    expect(await queuedSave).toBeNull();
    // The zombie store cleared: no record, no live doc, nothing to sync.
    expect(state.record).toBeNull();
    expect(state.doc).toBeNull();
  } finally {
    close();
  }
});

import { expect, test } from "bun:test";
import { createDocument } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { runSerializedSqlMutation } from "../../data/sqlite/sqlSchema";
import { createDocumentProjectorRegistry } from "../../documents";
import { saveDocumentRecord } from "../../stores/documents/documentStore/persistence";
import { createDocumentStoreState } from "../../stores/documents/documentStore/state";
import type { DocumentsRuntime } from "../../stores/documents/types";
import { persistDocumentState } from "./persistence";

// A persist that expected to UPDATE must not resurrect a document another
// subsystem deleted while the persist was in flight (the contacts
// duplicate-self cleanup racing a deferred write): the in-mutation existence
// check refuses the whole persist, history appends included.
test("an update persist refuses to resurrect a deleted row", async () => {
  const { close, execSql } = await createTestExecSql("persist-resurrect");
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
    const queuedPersist = persistDocumentState({
      currentDoc: doc,
      currentRecord,
      documentProjectors: createDocumentProjectorRegistry([]),
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

    expect(await queuedPersist).toBeNull();
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "victim"),
    ).toBeNull();
    const tails = await execSql(
      "SELECT id FROM document_history_updates WHERE local_id = 'victim'",
    );
    expect(tails).toEqual([]);
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

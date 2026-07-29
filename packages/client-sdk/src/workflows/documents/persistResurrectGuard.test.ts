import { expect, test } from "bun:test";
import { createDocument } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { createDocumentProjectorRegistry } from "../../documents";
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

    // The concurrent deletion lands before the persist claims the mutex.
    await sqlDocumentsPersistence.deleteDocument(execSql, "victim");

    const doc = await createDocument("persist-resurrect");
    doc.getText("text").update("racing edit");
    doc.commit();
    const persisted = await persistDocumentState({
      currentDoc: doc,
      currentRecord,
      documentProjectors: createDocumentProjectorRegistry([]),
      execSql,
      historyUpdates: ["cmFjaW5nLXRhaWw="],
      localId: "victim",
      persistence: sqlDocumentsPersistence,
    });

    expect(persisted).toBeNull();
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

import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDocumentProjectorRegistry } from "../../../data/documents";
import { DOCUMENTS_APP_KIND } from "../../../data/documents/documentConstants";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { enqueueDocumentPendingUpdate } from "../../../data/persistence/documents/records";
import { deleteDocumentUnlessQueued } from "./documentRemoval";

function storedDocument(localId: string) {
  return {
    accessEpoch: 1,
    containerId: "container",
    documentId: `${localId}-remote`,
    id: localId,
    snapshotEndVersion: "frontier",
    text: localId,
  };
}

test("a document with a write queued for upload is never deleted", async () => {
  const { close, execSql } = await createTestExecSql(
    "delete-document-unless-queued",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      storedDocument("edited"),
    );
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      storedDocument("synced"),
    );
    await enqueueDocumentPendingUpdate(
      execSql,
      { appKind: DOCUMENTS_APP_KIND, localId: "edited" },
      {
        partialEndVersionVector: "end",
        partialStartVersionVector: "start",
        updateData: "edit",
      },
    );
    const documentProjectors = createDocumentProjectorRegistry([]);

    expect(
      await deleteDocumentUnlessQueued({
        documentProjectors,
        execSql,
        localId: "edited",
      }),
    ).toBe(false);
    expect(
      await deleteDocumentUnlessQueued({
        documentProjectors,
        execSql,
        localId: "synced",
      }),
    ).toBe(true);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "edited"),
    ).not.toBeNull();
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "synced"),
    ).toBeNull();
  } finally {
    close();
  }
});

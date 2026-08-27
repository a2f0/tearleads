import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "./documentsPersistence";

function storedDocument(localId: string, documentId: string) {
  return {
    accessEpoch: 1,
    containerId: "container",
    documentId,
    id: localId,
    snapshotEndVersion: "frontier",
    text: localId,
  };
}

test("purge teardown refuses another local alias for the remote document", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-deletion-alias-test",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      storedDocument("local-a", "remote-document"),
    );
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      storedDocument("local-b", "remote-document"),
    );
    const expectedRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      "local-a",
    );
    if (!expectedRecord) throw new Error("Expected stored document");

    let callbackCalls = 0;
    await expect(
      sqlDocumentsPersistence.deleteDocumentIfMatches(
        execSql,
        expectedRecord,
        async () => {
          callbackCalls += 1;
        },
      ),
    ).resolves.toBe(false);
    await expect(
      sqlDocumentsPersistence.deleteDocumentSideRowsIfAbsent(
        execSql,
        "missing-local",
        "remote-document",
        async () => {
          callbackCalls += 1;
        },
      ),
    ).resolves.toBe(false);
    expect(callbackCalls).toBe(0);
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "local-a"),
    ).resolves.not.toBeNull();
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "local-b"),
    ).resolves.not.toBeNull();
  } finally {
    close();
  }
});

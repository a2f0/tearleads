import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "./documentsPersistence";

test("discovery and relink preserve malformed continuation recovery for the same identity", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-malformed-continuation",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 2,
      containerId: "container-a",
      documentId: "remote-document",
      id: "local-note",
      snapshotEndVersion: "version-1",
      text: "Existing local note",
    });
    await execSql(
      "UPDATE documents SET pull_continuation = :cursor WHERE app_kind = 'documents' AND local_id = :localId",
      { ":cursor": "not-json", ":localId": "local-note" },
    );

    await sqlDocumentsPersistence.upsertDiscoveredDocument(execSql, {
      accessEpoch: 2,
      containerId: "container-a",
      createdAt: "2026-04-06T00:00:00.000Z",
      documentId: "remote-document",
      linkedContainerIds: ["container-a"],
    });
    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, "local-note"))
        ?.pullContinuationRecoveryRequired,
    ).toBe(true);

    await sqlDocumentsPersistence.relinkPersistedDocument(execSql, {
      accessEpoch: 2,
      containerId: "container-b",
      documentId: "remote-document",
      localId: "local-note",
    });
    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, "local-note"))
        ?.pullContinuationRecoveryRequired,
    ).toBe(true);
    expect(
      await execSql(
        "SELECT pull_continuation FROM documents WHERE app_kind = 'documents' AND local_id = :localId",
        { ":localId": "local-note" },
      ),
    ).toEqual([{ pull_continuation: "not-json" }]);
  } finally {
    close();
  }
});

import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { sqlDocumentsPersistence } from "../documents/documentsPersistence";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";

test("document reassignment rolls back when its generation changes before commit", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-document-reassignment-generation",
  );
  let transactionStarted = false;
  const guardedExecSql = (async (...args: Parameters<ExecSql>) => {
    const rows = await execSql(...args);
    if (args[0].trim().toUpperCase().startsWith("BEGIN")) {
      transactionStarted = true;
    }
    return rows;
  }) as ExecSql;

  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      containerId: "stale-root",
      documentId: null,
      id: "local-document",
      snapshotEndVersion: "before",
      text: "before",
    });

    await sqlContainerContentsPersistence.reassignContainerDocuments(
      guardedExecSql,
      {
        fromContainerId: "stale-root",
        stillCurrent: () => !transactionStarted,
        toContainerId: "replacement-root",
      },
    );

    expect(transactionStarted).toBe(true);
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "local-document"),
    ).resolves.toMatchObject({ containerId: "stale-root" });
  } finally {
    close();
  }
});

import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { countingExecSql } from "../../../../../test/helpers/statementCounting";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import { sqlContainerContentsPersistence } from "../../container-contents/containerContentsPersistence";
import { ensureDocumentsSchema } from "./ensureDocumentsSchema";

// Each statement is one worker message on the client. A cold ensure sends its
// CREATE TABLEs, one required-column read, and its CREATE INDEXes: three
// messages (were 37 for documents and 46 for container contents, one per
// table, column check, and index).
const COLD_DOCUMENTS_ENSURE_STATEMENTS = 3;
const COLD_CONTAINER_CONTENTS_ENSURE_STATEMENTS = 3;

async function withCountingDatabase(
  name: string,
  run: (counting: ReturnType<typeof countingExecSql>) => Promise<void>,
): Promise<void> {
  const { close, execSql } = await createTestExecSql(name);
  try {
    await run(countingExecSql(execSql));
  } finally {
    close();
  }
}

test("a cold documents and container-contents ensure stays within its message budget", async () => {
  await withCountingDatabase("ensure-documents-budget", async (counting) => {
    const documents = await counting.count(() =>
      ensureDocumentsSchema(counting.execSql),
    );
    expect(documents).toBe(COLD_DOCUMENTS_ENSURE_STATEMENTS);
  });
  await withCountingDatabase("ensure-contents-budget", async (counting) => {
    const contents = await counting.count(() =>
      sqlContainerContentsPersistence.ensureSchema(counting.execSql),
    );
    expect(contents).toBe(COLD_CONTAINER_CONTENTS_ENSURE_STATEMENTS);
  });
});

test("a rolled-back transaction that ensured nothing keeps the schema memo", async () => {
  await withCountingDatabase("ensure-after-rollback", async (counting) => {
    await ensureDocumentsSchema(counting.execSql);
    await sqlContainerContentsPersistence.ensureSchema(counting.execSql);
    const runtime = getClientSQLitePersistenceRuntime(counting.execSql);
    await expect(
      runtime.transaction(async (tx) => {
        await tx.run("SELECT 1");
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");

    // The rollback undid no schema, so nothing re-runs (was 47 statements).
    const reEnsure = await counting.count(async () => {
      await ensureDocumentsSchema(counting.execSql);
      await sqlContainerContentsPersistence.ensureSchema(counting.execSql);
    });
    expect(reEnsure).toBe(0);
  });
});

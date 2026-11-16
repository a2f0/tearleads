import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentTables } from "../../../sqlite/schema/documentRecordSchema";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import { ensureSqlTables } from "../../../sqlite/sqlSchema";
import { DocumentRecordRepository } from "./documentRecordRepository";

const SCOPE = { appKind: "documents", localId: "stored" } as const;

async function readFailure(execSql: ExecSql, localId: string) {
  return execSql(
    `SELECT sync_failure_status AS status, sync_failure_message AS message,
       sync_failure_attempted_at AS attemptedAt
     FROM documents WHERE app_kind = 'documents' AND local_id = ?`,
    [localId],
  );
}

test("a sync failure lives and dies with its document row", async () => {
  const { close, execSql } = await createTestExecSql("document-sync-failure");
  try {
    const records = new DocumentRecordRepository(execSql);
    await ensureSqlTables(execSql, documentTables);
    await execSql(
      "INSERT INTO documents (app_kind, local_id, updated_at) VALUES ('documents', 'stored', '2026-10-14T00:00:00.000Z')",
    );

    await records.recordDocumentSyncFailure(SCOPE, {
      attemptedAt: "2026-10-14T00:00:01.000Z",
      message: "first",
      status: 409,
    });
    await records.recordDocumentSyncFailure(SCOPE, {
      attemptedAt: "2026-10-14T00:00:02.000Z",
      message: "second",
      status: null,
    });
    expect(await readFailure(execSql, "stored")).toEqual([
      {
        attemptedAt: "2026-10-14T00:00:02.000Z",
        message: "second",
        status: null,
      },
    ]);
    expect(await records.hasRecordedTerminalSyncFailures()).toBe(true);

    await records.clearDocumentSyncFailure(SCOPE);
    expect(await readFailure(execSql, "stored")).toEqual([
      { attemptedAt: null, message: null, status: null },
    ]);
    expect(await records.hasRecordedTerminalSyncFailures()).toBe(false);

    // A scope without a stored document has nothing to explain: recording is
    // a no-op instead of leaving a failure behind for a later sweep.
    await records.recordDocumentSyncFailure(
      { appKind: "documents", localId: "missing" },
      { attemptedAt: "2026-10-14T00:00:03.000Z", message: "gone", status: 404 },
    );
    expect(await readFailure(execSql, "missing")).toEqual([]);
    expect(await records.hasRecordedTerminalSyncFailures()).toBe(false);

    await records.recordDocumentSyncFailure(SCOPE, {
      attemptedAt: "2026-10-14T00:00:04.000Z",
      message: "third",
      status: 403,
    });
    await records.deleteDocumentRecord(SCOPE);
    expect(await records.hasRecordedTerminalSyncFailures()).toBe(false);
  } finally {
    await close();
  }
});

import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { deleteDocumentRecord } from "./documentRecordPersistence";
import {
  clearDocumentSyncFailure,
  hasRecordedTerminalSyncFailures,
  recordDocumentSyncFailure,
} from "./documentSyncFailurePersistence";
import { documentTables } from "./schema";
import type { ExecSql } from "./sqlSchema";
import { ensureSqlTables } from "./sqlSchema";

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
    await ensureSqlTables(execSql, documentTables);
    await execSql(
      "INSERT INTO documents (app_kind, local_id, updated_at) VALUES ('documents', 'stored', '2026-10-14T00:00:00.000Z')",
    );

    await recordDocumentSyncFailure(execSql, SCOPE, {
      attemptedAt: "2026-10-14T00:00:01.000Z",
      message: "first",
      status: 409,
    });
    await recordDocumentSyncFailure(execSql, SCOPE, {
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
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(true);

    await clearDocumentSyncFailure(execSql, SCOPE);
    expect(await readFailure(execSql, "stored")).toEqual([
      { attemptedAt: null, message: null, status: null },
    ]);
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);

    // A scope without a stored document has nothing to explain: recording is
    // a no-op instead of leaving a failure behind for a later sweep.
    await recordDocumentSyncFailure(
      execSql,
      { appKind: "documents", localId: "missing" },
      { attemptedAt: "2026-10-14T00:00:03.000Z", message: "gone", status: 404 },
    );
    expect(await readFailure(execSql, "missing")).toEqual([]);
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);

    await recordDocumentSyncFailure(execSql, SCOPE, {
      attemptedAt: "2026-10-14T00:00:04.000Z",
      message: "third",
      status: 403,
    });
    await deleteDocumentRecord(execSql, SCOPE);
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);
  } finally {
    await close();
  }
});

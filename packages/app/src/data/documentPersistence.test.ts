import { expect, test } from "bun:test";
import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import {
  ensureDocumentTables,
  loadDocumentRecord,
  saveDocumentRecord,
} from "./documentPersistence";

async function createExecSql() {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = Bun.fetch;

  let db: Awaited<ReturnType<typeof initDatabase>>;
  try {
    db = await initDatabase({
      dbName: `/${crypto.randomUUID()}.db`,
      cipher: "chacha20",
      key: "document-persistence-test",
    });
  } finally {
    globalThis.fetch = previousFetch;
  }

  return {
    close: () => db.close(),
    execSql: async (
      sql: string,
      bind?: Record<string, string | number | null>,
    ) => execDatabaseStatement(db, bind ? { bind, sql } : { sql }),
  };
}

test("ensureDocumentTables adds last_commit_lsn for existing local documents tables", async () => {
  const { close, execSql } = await createExecSql();

  try {
    await execSql(`
      CREATE TABLE documents (
        app_kind TEXT NOT NULL,
        local_id TEXT NOT NULL,
        document_id TEXT,
        document_recipient_envelopes TEXT,
        loro_snapshot TEXT NOT NULL,
        access_epoch INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (app_kind, local_id)
      )
    `);

    await ensureDocumentTables(execSql);

    await saveDocumentRecord(
      execSql,
      {
        appKind: "documents",
        localId: "local-document-1",
      },
      {
        accessEpoch: 2,
        documentId: "remote-document-1",
        documentRecipientEnvelopes: "[]",
        id: "local-document-1",
        lastCommitLsn: "0/10",
        loroSnapshot: "snapshot-1",
      },
      "2026-04-12T00:00:00.000Z",
    );

    await expect(
      loadDocumentRecord(execSql, {
        appKind: "documents",
        localId: "local-document-1",
      }),
    ).resolves.toEqual({
      accessEpoch: 2,
      documentId: "remote-document-1",
      documentRecipientEnvelopes: "[]",
      id: "local-document-1",
      lastCommitLsn: "0/10",
      loroSnapshot: "snapshot-1",
    });
  } finally {
    close();
  }
});

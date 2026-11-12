import { expect, test } from "bun:test";
import { createMemoryBlobStore } from "@tearleads/client-sdk";
import {
  type ExecSql,
  ensureSqlTables,
  LOCAL_SCHEMA_MIGRATIONS_TABLE,
  type SqlTableSchema,
} from "@tearleads/client-sdk/sqlite";
import { createTestExecSql } from "@tearleads/test-utils";
import { unexpectedSecurityIncidents } from "../../../test/helpers/unexpectedSecurityIncidents";
import { createBackupPayload, restoreBackupPayload } from "./localBackupData";

test.each([
  "DELETE FROM documents",
  "CREATE INDEX documents_idx ON documents(id); DELETE FROM documents",
  "COMMIT; DELETE FROM documents; BEGIN IMMEDIATE",
])(
  "restore rejects executable backup index SQL before replacing data: %s",
  async (sql) => {
    const source = await createTestExecSql("backup-schema-source");
    const target = await createTestExecSql("backup-schema-target");
    try {
      await source.execSql("CREATE TABLE documents (id TEXT PRIMARY KEY)");
      await source.execSql("INSERT INTO documents VALUES ('backup-document')");
      await target.execSql("CREATE TABLE documents (id TEXT PRIMARY KEY)");
      await target.execSql("INSERT INTO documents VALUES ('current-document')");
      const blobStore = createMemoryBlobStore();
      const payload = await createBackupPayload({
        blobStore,
        databaseId: null,
        execSql: source.execSql,
        signingFingerprint: null,
      });
      await expect(
        restoreBackupPayload({
          blobStore,
          execSql: target.execSql,
          securityIncidents: unexpectedSecurityIncidents,
          payload: {
            ...payload,
            database: {
              ...payload.database,
              indexes: [{ name: "documents_idx", tableName: "documents", sql }],
            },
          },
        }),
      ).rejects.toThrow("Backup schema");
      expect(await target.execSql("SELECT * FROM documents")).toEqual([
        { id: "current-document" },
      ]);
    } finally {
      source.close();
      target.close();
    }
  },
);

const notesTable: SqlTableSchema = {
  createSql: "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY)",
  name: "notes",
};

async function backupOf(execSql: ExecSql) {
  return createBackupPayload({
    blobStore: createMemoryBlobStore(),
    databaseId: null,
    execSql,
    signingFingerprint: null,
  });
}

test("restore refuses a backup from a newer local schema before replacing data", async () => {
  const source = await createTestExecSql("backup-ledger-newer-source");
  const target = await createTestExecSql("backup-ledger-newer-target");
  try {
    await ensureSqlTables(source.execSql, [notesTable]);
    const backup = await backupOf(source.execSql);
    // A newer build's backup records a step this build does not know.
    const tables = backup.database.tables.map((table) =>
      table.name === LOCAL_SCHEMA_MIGRATIONS_TABLE
        ? {
            ...table,
            rows: [
              ...table.rows,
              { applied_at: 0, name: "future", version: 2 },
            ],
          }
        : table,
    );
    await ensureSqlTables(target.execSql, [notesTable]);
    await target.execSql("INSERT INTO notes VALUES ('current-note')");
    await expect(
      restoreBackupPayload({
        blobStore: createMemoryBlobStore(),
        execSql: target.execSql,
        securityIncidents: unexpectedSecurityIncidents,
        payload: { ...backup, database: { ...backup.database, tables } },
      }),
    ).rejects.toThrow(
      "Local database schema version 2 is newer than this app supports (1)",
    );
    expect(await target.execSql("SELECT id FROM notes")).toEqual([
      { id: "current-note" },
    ]);
  } finally {
    source.close();
    target.close();
  }
});

test("a backup from before the ledger restores at the baseline and records it on the next ensure", async () => {
  const source = await createTestExecSql("backup-ledger-legacy-source");
  const target = await createTestExecSql("backup-ledger-legacy-target");
  try {
    await source.execSql(notesTable.createSql);
    await source.execSql("INSERT INTO notes VALUES ('backup-note')");
    await ensureSqlTables(target.execSql, [notesTable]);
    await restoreBackupPayload({
      blobStore: createMemoryBlobStore(),
      execSql: target.execSql,
      securityIncidents: unexpectedSecurityIncidents,
      payload: await backupOf(source.execSql),
    });
    await ensureSqlTables(target.execSql, [notesTable]);
    expect(
      await target.execSql(
        `SELECT version, name FROM ${LOCAL_SCHEMA_MIGRATIONS_TABLE}`,
      ),
    ).toEqual([{ name: "baseline", version: 1 }]);
    expect(await target.execSql("SELECT id FROM notes")).toEqual([
      { id: "backup-note" },
    ]);
  } finally {
    source.close();
    target.close();
  }
});

test("restore refuses a backup that lists a table twice before replacing data", async () => {
  const source = await createTestExecSql("backup-ledger-duplicate-source");
  const target = await createTestExecSql("backup-ledger-duplicate-target");
  try {
    await ensureSqlTables(source.execSql, [notesTable]);
    const backup = await backupOf(source.execSql);
    const ledgerTable = backup.database.tables.find(
      ({ name }) => name === LOCAL_SCHEMA_MIGRATIONS_TABLE,
    );
    if (!ledgerTable) throw new Error("backup has no ledger");
    // The first copy passes the ledger check; the second would restore a
    // newer build's step into the same table.
    const duplicate = {
      ...ledgerTable,
      rows: [{ applied_at: 0, name: "future", version: 2 }],
      sql: ledgerTable.sql.replace(
        "CREATE TABLE",
        "CREATE TABLE IF NOT EXISTS",
      ),
    };
    await ensureSqlTables(target.execSql, [notesTable]);
    await target.execSql("INSERT INTO notes VALUES ('current-note')");
    await expect(
      restoreBackupPayload({
        blobStore: createMemoryBlobStore(),
        execSql: target.execSql,
        securityIncidents: unexpectedSecurityIncidents,
        payload: {
          ...backup,
          database: {
            ...backup.database,
            tables: [...backup.database.tables, duplicate],
          },
        },
      }),
    ).rejects.toThrow(
      `Backup schema lists table ${LOCAL_SCHEMA_MIGRATIONS_TABLE} more than once.`,
    );
    expect(await target.execSql("SELECT id FROM notes")).toEqual([
      { id: "current-note" },
    ]);
  } finally {
    source.close();
    target.close();
  }
});

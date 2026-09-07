import { expect, test } from "bun:test";
import { createMemoryBlobStore } from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";
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

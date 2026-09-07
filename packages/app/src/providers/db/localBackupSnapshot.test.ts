import { expect, test } from "bun:test";
import { createMemoryBlobStore } from "@tearleads/client-sdk";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "@tearleads/client-sdk/sqlite";
import { createTestExecSql } from "@tearleads/test-utils";
import { createBackupPayload, restoreBackupPayload } from "./localBackupData";

test("backup keeps related rows and blob bytes consistent during a concurrent deletion", async () => {
  const source = await createTestExecSql("backup-snapshot-source");
  const target = await createTestExecSql("backup-snapshot-target");
  const execSql = source.execSql as ExecSql;
  const blobStore = createMemoryBlobStore();
  let deletion: Promise<void> | undefined;
  try {
    await execSql("CREATE TABLE documents (id TEXT PRIMARY KEY)");
    await execSql(`CREATE TABLE document_pending_attachments (
      storage_key TEXT PRIMARY KEY, local_id TEXT REFERENCES documents(id)
    )`);
    await execSql("INSERT INTO documents VALUES ('document-1')");
    await execSql(
      "INSERT INTO document_pending_attachments VALUES ('blob-1', 'document-1')",
    );
    await blobStore.writeBytes("blob-1", new Uint8Array([1, 2, 3]));

    const payload = await createBackupPayload({
      blobStore,
      databaseId: "source",
      execSql,
      signingFingerprint: null,
      onProgress: (progress) => {
        // Attachments sort before documents. Delete after the first table has
        // been exported, as a background purge or sync operation could do.
        if (progress.phase === "database" && progress.item === "documents") {
          deletion = runSerializedSqlMutation(
            execSql,
            async (lockedExecSql) => {
              await lockedExecSql("BEGIN IMMEDIATE");
              await lockedExecSql("DELETE FROM document_pending_attachments");
              await lockedExecSql("DELETE FROM documents");
              await lockedExecSql("COMMIT");
              await blobStore.deleteBytes("blob-1");
            },
          );
        }
      },
    });
    await deletion;

    const restoredBlobs = createMemoryBlobStore();
    await restoreBackupPayload({
      blobStore: restoredBlobs,
      execSql: target.execSql as ExecSql,
      payload,
    });
    expect(await target.execSql("SELECT * FROM documents")).toEqual([
      { id: "document-1" },
    ]);
    expect(await target.execSql("PRAGMA foreign_key_check")).toEqual([]);
    expect(await restoredBlobs.readBytes("blob-1")).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(payload.missingBlobStorageKeys).toEqual([]);
    expect(await execSql("SELECT * FROM documents")).toEqual([]);
  } finally {
    await deletion;
    source.close();
    target.close();
  }
});

test("failed backup releases its transaction so later writes and backups succeed", async () => {
  const source = await createTestExecSql("backup-snapshot-failure");
  try {
    await source.execSql("CREATE TABLE documents (id TEXT PRIMARY KEY)");
    const input = {
      blobStore: createMemoryBlobStore(),
      databaseId: null,
      execSql: source.execSql,
      signingFingerprint: null,
    };
    await expect(
      createBackupPayload({
        ...input,
        onProgress: () => {
          throw new Error("export cancelled");
        },
      }),
    ).rejects.toThrow("export cancelled");
    await runSerializedSqlMutation(source.execSql, async (execSql) => {
      await execSql("BEGIN IMMEDIATE");
      await execSql("INSERT INTO documents VALUES ('after-failure')");
      await execSql("COMMIT");
    });
    const payload = await createBackupPayload(input);
    expect(payload.database.tables[0]?.rows).toEqual([{ id: "after-failure" }]);
  } finally {
    source.close();
  }
});

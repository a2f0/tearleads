import { expect, test } from "bun:test";
import {
  type BlobByteSource,
  type BlobBytes,
  type BlobStore,
  createBlobByteSource,
  readBlobByteSource,
} from "@tearleads/client-sdk";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
  type SqlTableSchema,
} from "@tearleads/client-sdk/sqlite";
import { createTestExecSql } from "@tearleads/test-utils";
import { createBackupPayload, restoreBackupPayload } from "./localBackupData";
import { restoreBackupDatabase } from "./localBackupDatabase";
import {
  type BackupPayload,
  decodeBackupFile,
  encodeBackupFile,
} from "./localBackupFormat";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

class TestBlobStore implements BlobStore {
  readonly bytesByKey = new Map<string, BlobBytes>();

  async deleteBytes(storageKey: string): Promise<void> {
    this.bytesByKey.delete(storageKey);
  }

  async readBytes(storageKey: string): Promise<BlobBytes | null> {
    return this.bytesByKey.get(storageKey) ?? null;
  }

  async openByteSource(storageKey: string): Promise<BlobByteSource | null> {
    const bytes = this.bytesByKey.get(storageKey);
    return bytes ? createBlobByteSource(bytes.slice() as BlobBytes) : null;
  }

  async writeByteSource(
    storageKey: string,
    source: BlobByteSource,
  ): Promise<void> {
    await this.writeBytes(storageKey, await readBlobByteSource(source));
  }

  async writeBytes(storageKey: string, bytes: BlobBytes): Promise<void> {
    this.bytesByKey.set(storageKey, bytes.slice() as BlobBytes);
  }
}

function blobBytes(value: string): BlobBytes {
  return TEXT_ENCODER.encode(value) as BlobBytes;
}

function decodeBlob(bytes: BlobBytes | null): string | null {
  return bytes ? TEXT_DECODER.decode(bytes) : null;
}

function readRowName(row: Record<string, unknown>): unknown {
  const key = "name";
  return row[key];
}

function readRowValue(row: Record<string, unknown> | undefined, key: string) {
  return row?.[key];
}

async function seedBackupDatabase(execSql: ExecSql): Promise<void> {
  await execSql(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      note_count INTEGER NOT NULL,
      pull_continuation TEXT
    )
  `);
  await execSql("CREATE INDEX documents_title_idx ON documents(title)");
  await execSql(`
    CREATE TABLE document_pending_attachments (
      local_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      PRIMARY KEY (local_id, slot_id)
    )
  `);
  await execSql(`
    CREATE TABLE document_attachment_blob_projection (
      local_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      PRIMARY KEY (local_id, slot_id)
    )
  `);
  await execSql(`
    CREATE TABLE parent_records (
      id TEXT PRIMARY KEY
    )
  `);
  await execSql(`
    CREATE TABLE child_records (
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL REFERENCES parent_records(id)
    )
  `);
  await execSql(
    "INSERT INTO documents (id, title, note_count, pull_continuation) VALUES (?, ?, ?, ?)",
    ["doc-1", "First", 3, '[1,"tracked","0/2","page-2"]'],
  );
  await execSql(
    "INSERT INTO document_pending_attachments (local_id, slot_id, storage_key) VALUES (?, ?, ?)",
    ["doc-1", "slot-1", "pending-blob"],
  );
  await execSql(
    "INSERT INTO document_attachment_blob_projection (local_id, slot_id, storage_key) VALUES (?, ?, ?)",
    ["doc-1", "slot-2", "stored-blob"],
  );
  await execSql("INSERT INTO parent_records (id) VALUES (?)", ["parent-1"]);
  await execSql("INSERT INTO child_records (id, parent_id) VALUES (?, ?)", [
    "child-1",
    "parent-1",
  ]);
}

test("backup export and restore preserves SQLite rows, indexes, and blob bytes", async () => {
  const source = await createTestExecSql("backup-source-key");
  const target = await createTestExecSql("backup-target-key");
  const sourceBlobStore = new TestBlobStore();
  const targetBlobStore = new TestBlobStore();

  try {
    await seedBackupDatabase(source.execSql as ExecSql);
    await sourceBlobStore.writeBytes(
      "pending-blob",
      blobBytes("pending bytes"),
    );
    await sourceBlobStore.writeBytes("stored-blob", blobBytes("stored bytes"));

    const payload = await createBackupPayload({
      blobStore: sourceBlobStore,
      databaseId: "source-db",
      execSql: source.execSql as ExecSql,
      signingFingerprint: "fingerprint-source",
    });

    expect(payload.version).toBe(7);
    expect(payload.summary.rowCount).toBe(5);
    expect(payload.summary.blobCount).toBe(2);
    expect(payload.database.indexes.map((index) => index.name)).toContain(
      "documents_title_idx",
    );

    const encoded = await encodeBackupFile({
      password: "test-password",
      payload,
    });
    const legacyEnvelope = JSON.parse(encoded) as { version: number };
    legacyEnvelope.version = 6;
    await expect(
      decodeBackupFile({
        password: "test-password",
        text: JSON.stringify(legacyEnvelope),
      }),
    ).rejects.toThrow("Backup file version is not supported.");

    const legacyPayload = {
      ...payload,
      version: 6,
    } as unknown as BackupPayload;
    const encodedLegacyPayload = await encodeBackupFile({
      password: "test-password",
      payload: legacyPayload,
    });
    await expect(
      decodeBackupFile({
        password: "test-password",
        text: encodedLegacyPayload,
      }),
    ).rejects.toThrow("Backup payload version is not supported.");

    await expect(
      decodeBackupFile({ password: "wrong-password", text: encoded }),
    ).rejects.toThrow("Backup password is incorrect");

    const unsafeEnvelope = JSON.parse(encoded) as {
      kdf: { iterations: number };
    };
    unsafeEnvelope.kdf.iterations = 1_000_001;
    await expect(
      decodeBackupFile({
        password: "test-password",
        text: JSON.stringify(unsafeEnvelope),
      }),
    ).rejects.toThrow("Backup KDF iterations count is out of safe bounds.");

    const decoded = await decodeBackupFile({
      password: "test-password",
      text: encoded,
    });
    await target.execSql("PRAGMA foreign_keys = ON");
    await target.execSql(`
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        stale TEXT NOT NULL
      )
    `);
    await target.execSql(`
      CREATE TABLE stale_values (
        id TEXT PRIMARY KEY
      )
    `);
    await restoreBackupPayload({
      blobStore: targetBlobStore,
      execSql: target.execSql as ExecSql,
      payload: decoded,
    });

    await expect(
      target.execSql(
        "SELECT title, note_count, pull_continuation FROM documents",
      ),
    ).resolves.toEqual([
      {
        note_count: 3,
        pull_continuation: '[1,"tracked","0/2","page-2"]',
        title: "First",
      },
    ]);
    await expect(
      target.execSql(
        "SELECT storage_key FROM document_attachment_blob_projection",
      ),
    ).resolves.toEqual([{ storage_key: "stored-blob" }]);
    await expect(
      target.execSql("SELECT parent_id FROM child_records"),
    ).resolves.toEqual([{ parent_id: "parent-1" }]);
    await expect(
      target.execSql(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stale_values'",
      ),
    ).resolves.toEqual([]);
    expect(
      readRowValue(
        (await target.execSql("PRAGMA foreign_keys"))[0],
        "foreign_keys",
      ),
    ).toBe(1);

    const indexes = await target.execSql("PRAGMA index_list(documents)");
    expect(
      indexes.some((row) => readRowName(row) === "documents_title_idx"),
    ).toBe(true);
    expect(decodeBlob(await targetBlobStore.readBytes("pending-blob"))).toBe(
      "pending bytes",
    );
    expect(decodeBlob(await targetBlobStore.readBytes("stored-blob"))).toBe(
      "stored bytes",
    );
  } finally {
    source.close();
    target.close();
  }
});

test("restore resets the schema-ensure memo through a locked executor", async () => {
  const { close, execSql } = await createTestExecSql("backup-memo-reset");
  try {
    const memoProbeTable: SqlTableSchema = {
      name: "memo_probe",
      createSql:
        'CREATE TABLE IF NOT EXISTS "memo_probe" ("id" TEXT PRIMARY KEY)',
    };
    const calls: string[] = [];
    const spyExecSql = ((
      sql: string,
      bind?: Parameters<ExecSql>[1],
      options?: { rowMode?: "object" | "array" },
    ) => {
      calls.push(sql);
      return execSql(sql, bind, options);
    }) as ExecSql;

    await ensureSqlTables(spyExecSql, [memoProbeTable]);
    const callsAfterFirstEnsure = calls.length;
    expect(callsAfterFirstEnsure).toBeGreaterThan(0);
    await ensureSqlTables(spyExecSql, [memoProbeTable]);
    expect(calls.length).toBe(callsAfterFirstEnsure);

    // Production wiring: restoreBackupDatabase runs under restoreBackupPayload's
    // outer mutation lock and receives the LOCKED executor, so the memo reset
    // inside it must resolve that wrapper back to the canonical connection.
    await runSerializedSqlMutation(spyExecSql, async (lockedExecSql) => {
      await restoreBackupDatabase({
        execSql: lockedExecSql,
        indexes: [],
        tables: [],
      });
    });

    // The restore dropped every user table; the memo must be forgotten so the
    // next ensure actually recreates the table instead of no-opping.
    const callsBeforeReEnsure = calls.length;
    await ensureSqlTables(spyExecSql, [memoProbeTable]);
    expect(calls.length).toBeGreaterThan(callsBeforeReEnsure);
    expect(await spyExecSql('SELECT count(*) AS n FROM "memo_probe"')).toEqual([
      { n: 0 },
    ]);
  } finally {
    close();
  }
});

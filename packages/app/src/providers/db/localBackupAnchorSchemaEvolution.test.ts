import { expect, test } from "bun:test";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  readBackupDatabase,
  restoreBackupDatabase,
} from "./localBackupDatabase";

const UPDATED_AT = "2026-09-12T12:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

async function createPurgeTable(
  execSql: ExecSql,
  extraColumns = "",
): Promise<void> {
  await execSql(`CREATE TABLE document_purge_checkpoints (
    document_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
    document_manifest_hash TEXT NOT NULL, purge_event_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL${extraColumns}
  )`);
}

async function createAccessTable(
  execSql: ExecSql,
  extraColumns = "",
): Promise<void> {
  await execSql(`CREATE TABLE access_manifest_checkpoints (
    object_kind TEXT NOT NULL, organization_id TEXT NOT NULL,
    object_id TEXT NOT NULL, epoch INTEGER NOT NULL,
    manifest_hash TEXT NOT NULL, updated_at TEXT NOT NULL${extraColumns},
    PRIMARY KEY (object_kind, organization_id, object_id)
  )`);
}

async function insertAccess(
  execSql: ExecSql,
  epoch: number,
  hash: string,
): Promise<void> {
  await execSql(
    "INSERT INTO access_manifest_checkpoints (object_kind, organization_id, object_id, epoch, manifest_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["document", "organization-1", "document-1", epoch, hash, UPDATED_AT],
  );
}

async function columnsOf(execSql: ExecSql, table: string): Promise<string[]> {
  const rows = await execSql(`PRAGMA table_info("${table}")`);
  return rows.map(({ name }) => String(name));
}

async function indexesOf(execSql: ExecSql, table: string): Promise<string[]> {
  const rows = await execSql(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%' ORDER BY name",
    [table],
  );
  return rows.map(({ name }) => String(name));
}

test("a live anchor table with a column the backup lacks restores and keeps live values", async () => {
  const source = createNativeTestExecSql();
  const target = createNativeTestExecSql();
  try {
    await createPurgeTable(source.execSql);
    await createPurgeTable(
      target.execSql,
      ", note TEXT NOT NULL DEFAULT 'default'",
    );
    await createAccessTable(source.execSql);
    await createAccessTable(target.execSql, ", note TEXT");
    await source.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
      ["backup-only", "organization-1", HASH_A, HASH_A, UPDATED_AT],
    );
    await target.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?, ?)",
      ["local-only", "organization-1", HASH_A, HASH_A, UPDATED_AT, "kept"],
    );
    // The backup wins this scope on epoch, but the live-only column survives.
    await insertAccess(source.execSql, 3, HASH_B);
    await insertAccess(target.execSql, 2, HASH_A);
    await target.execSql(
      "UPDATE access_manifest_checkpoints SET note = 'live'",
    );
    const backup = await readBackupDatabase({ execSql: source.execSql });
    await restoreBackupDatabase({ ...backup, execSql: target.execSql });
    expect(
      await columnsOf(target.execSql, "document_purge_checkpoints"),
    ).toEqual([
      "document_id",
      "organization_id",
      "document_manifest_hash",
      "purge_event_hash",
      "updated_at",
      "note",
    ]);
    expect(
      await target.execSql(
        "SELECT document_id, note FROM document_purge_checkpoints ORDER BY document_id",
      ),
    ).toEqual([
      { document_id: "backup-only", note: "default" },
      { document_id: "local-only", note: "kept" },
    ]);
    expect(
      await target.execSql(
        "SELECT epoch, manifest_hash, note FROM access_manifest_checkpoints",
      ),
    ).toEqual([{ epoch: 3, manifest_hash: HASH_B, note: "live" }]);
  } finally {
    source.close();
    target.close();
  }
});

test("a backup anchor table with a column the live table lacks restores without it", async () => {
  const source = createNativeTestExecSql();
  const target = createNativeTestExecSql();
  try {
    await createPurgeTable(source.execSql, ", extra TEXT");
    await createPurgeTable(target.execSql);
    await source.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?, ?)",
      ["document-1", "organization-1", HASH_A, HASH_A, UPDATED_AT, "dropped"],
    );
    const backup = await readBackupDatabase({ execSql: source.execSql });
    await restoreBackupDatabase({ ...backup, execSql: target.execSql });
    expect(
      await columnsOf(target.execSql, "document_purge_checkpoints"),
    ).toEqual([
      "document_id",
      "organization_id",
      "document_manifest_hash",
      "purge_event_hash",
      "updated_at",
    ]);
    expect(
      await target.execSql("SELECT * FROM document_purge_checkpoints"),
    ).toEqual([
      {
        document_id: "document-1",
        organization_id: "organization-1",
        document_manifest_hash: HASH_A,
        purge_event_hash: HASH_A,
        updated_at: UPDATED_AT,
      },
    ]);
  } finally {
    source.close();
    target.close();
  }
});

test("a backup index on a dropped anchor column yields to the live indexes", async () => {
  const source = createNativeTestExecSql();
  const target = createNativeTestExecSql();
  try {
    await createPurgeTable(source.execSql, ", extra TEXT");
    await source.execSql(
      "CREATE INDEX purge_extra_idx ON document_purge_checkpoints (extra)",
    );
    await source.execSql(
      "CREATE INDEX purge_updated_idx ON document_purge_checkpoints (updated_at)",
    );
    await source.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?, ?)",
      ["document-1", "organization-1", HASH_A, HASH_A, UPDATED_AT, "dropped"],
    );
    await createPurgeTable(target.execSql);
    await target.execSql(
      "CREATE INDEX purge_org_idx ON document_purge_checkpoints (organization_id)",
    );
    // Non-anchor tables keep the backup's indexes.
    await source.execSql("CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT)");
    await source.execSql("CREATE INDEX notes_body_idx ON notes (body)");
    const backup = await readBackupDatabase({ execSql: source.execSql });
    await restoreBackupDatabase({ ...backup, execSql: target.execSql });
    expect(
      await indexesOf(target.execSql, "document_purge_checkpoints"),
    ).toEqual(["purge_org_idx"]);
    expect(await indexesOf(target.execSql, "notes")).toEqual([
      "notes_body_idx",
    ]);
    expect(
      await target.execSql(
        "SELECT document_id, organization_id FROM document_purge_checkpoints",
      ),
    ).toEqual([
      { document_id: "document-1", organization_id: "organization-1" },
    ]);
  } finally {
    source.close();
    target.close();
  }
});

test("a backup anchor table with an extra column is adopted whole where the table is still lazy", async () => {
  const source = createNativeTestExecSql();
  const target = createNativeTestExecSql();
  try {
    await createPurgeTable(source.execSql, ", extra TEXT");
    await source.execSql(
      "CREATE INDEX purge_extra_idx ON document_purge_checkpoints (extra)",
    );
    await source.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?, ?)",
      ["document-1", "organization-1", HASH_A, HASH_A, UPDATED_AT, "kept"],
    );
    const backup = await readBackupDatabase({ execSql: source.execSql });
    await restoreBackupDatabase({ ...backup, execSql: target.execSql });
    expect(
      await target.execSql(
        "SELECT document_id, extra FROM document_purge_checkpoints",
      ),
    ).toEqual([{ document_id: "document-1", extra: "kept" }]);
    expect(
      await indexesOf(target.execSql, "document_purge_checkpoints"),
    ).toEqual(["purge_extra_idx"]);
  } finally {
    source.close();
    target.close();
  }
});

test("a backup anchor table missing an anchor column is refused before changing the database", async () => {
  const source = createNativeTestExecSql();
  const target = createNativeTestExecSql();
  try {
    await source.execSql(`CREATE TABLE document_purge_checkpoints (
      document_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
      document_manifest_hash TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    await source.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?)",
      ["document-1", "organization-1", HASH_A, UPDATED_AT],
    );
    await createPurgeTable(target.execSql);
    await target.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
      ["local-only", "organization-1", HASH_A, HASH_A, UPDATED_AT],
    );
    const before = await readBackupDatabase({ execSql: target.execSql });
    const backup = await readBackupDatabase({ execSql: source.execSql });
    await expect(
      restoreBackupDatabase({ ...backup, execSql: target.execSql }),
    ).rejects.toThrow(
      "Document purge checkpoint backup is missing the purge_event_hash column",
    );
    expect(await readBackupDatabase({ execSql: target.execSql })).toEqual(
      before,
    );
  } finally {
    source.close();
    target.close();
  }
});

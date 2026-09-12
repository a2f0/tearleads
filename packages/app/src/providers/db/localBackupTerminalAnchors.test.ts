import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  preflightSecurityAnchorRestore,
  readBackupDatabase,
  restoreBackupDatabase,
} from "./localBackupDatabase";

const UPDATED_AT = "2026-09-12T12:00:00.000Z";
const HASH = "a".repeat(64);

const schema = [
  `CREATE TABLE document_purge_checkpoints (
    document_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
    document_manifest_hash TEXT NOT NULL, purge_event_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE security_incidents (
    id TEXT PRIMARY KEY, trust_domain TEXT, code TEXT NOT NULL,
    operation TEXT NOT NULL, object_kind TEXT NOT NULL, object_id TEXT,
    organization_id TEXT, evidence_hashes TEXT NOT NULL,
    detected_at TEXT NOT NULL, last_detected_at TEXT NOT NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 1
  )`,
];

test("restoring a database without terminal anchors preserves purge pins and incidents", async () => {
  const target = createNativeTestExecSql();
  try {
    for (const sql of schema) await target.execSql(sql);
    await target.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
      ["document-1", "organization-1", HASH, HASH, UPDATED_AT],
    );
    await target.execSql(
      "INSERT INTO security_incidents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "incident-1",
        null,
        "equivocation",
        "sync",
        "document",
        "document-1",
        "organization-1",
        "{}",
        UPDATED_AT,
        UPDATED_AT,
        2,
      ],
    );
    const before = await readBackupDatabase({ execSql: target.execSql });
    await restoreBackupDatabase({
      execSql: target.execSql,
      indexes: [],
      tables: [],
    });
    const after = await readBackupDatabase({ execSql: target.execSql });
    expect(after.tables).toEqual(before.tables);
  } finally {
    target.close();
  }
});

test("restore unions terminal evidence and merges repeated incident observations idempotently", async () => {
  const target = createNativeTestExecSql();
  const source = createNativeTestExecSql();
  try {
    for (const db of [source, target]) {
      for (const sql of schema) await db.execSql(sql);
      await db.execSql(
        "INSERT INTO security_incidents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          "incident-1",
          null,
          "equivocation",
          "sync",
          "document",
          "document-1",
          "organization-1",
          "{}",
          UPDATED_AT,
          UPDATED_AT,
          db === source ? 5 : 2,
        ],
      );
    }
    await source.execSql("UPDATE security_incidents SET detected_at = ?", [
      "2026-09-11T12:00:00.000Z",
    ]);
    await target.execSql("UPDATE security_incidents SET last_detected_at = ?", [
      "2026-09-13T12:00:00.000Z",
    ]);
    for (const [db, documentId] of [
      [source, "backup-only"],
      [target, "local-only"],
    ] as const) {
      await db.execSql(
        "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
        [documentId, "organization-1", HASH, HASH, UPDATED_AT],
      );
    }
    const backup = await readBackupDatabase({ execSql: source.execSql });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await restoreBackupDatabase({ ...backup, execSql: target.execSql });
      expect(
        await target.execSql(
          "SELECT document_id FROM document_purge_checkpoints ORDER BY document_id",
        ),
      ).toEqual([
        { document_id: "backup-only" },
        { document_id: "local-only" },
      ]);
      expect(
        await target.execSql(
          "SELECT detected_at, last_detected_at, occurrence_count FROM security_incidents",
        ),
      ).toEqual([
        {
          detected_at: "2026-09-11T12:00:00.000Z",
          last_detected_at: "2026-09-13T12:00:00.000Z",
          occurrence_count: 5,
        },
      ]);
    }
  } finally {
    source.close();
    target.close();
  }
});

for (const column of [
  "organization_id",
  "document_manifest_hash",
  "purge_event_hash",
]) {
  test(`restore rejects a conflicting purge ${column} before changing the database`, async () => {
    const target = createNativeTestExecSql();
    try {
      for (const sql of schema) await target.execSql(sql);
      await target.execSql(
        "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
        ["document-1", "organization-1", HASH, HASH, UPDATED_AT],
      );
      const backup = await readBackupDatabase({ execSql: target.execSql });
      const conflicting = backup.tables.map((table) =>
        table.name === "document_purge_checkpoints"
          ? {
              ...table,
              rows: table.rows.map((row) => ({
                ...row,
                [column]: "b".repeat(64),
              })),
            }
          : table,
      );
      await expect(
        restoreBackupDatabase({
          ...backup,
          tables: conflicting,
          execSql: target.execSql,
        }),
      ).rejects.toThrow("Backup conflicts with document purge checkpoint");
      expect(
        (await readBackupDatabase({ execSql: target.execSql })).tables,
      ).toEqual(backup.tables);
    } finally {
      target.close();
    }
  });
}

test("restore refuses an incident identity collision without erasing local evidence", async () => {
  const target = createNativeTestExecSql();
  try {
    for (const sql of schema) await target.execSql(sql);
    await target.execSql(
      "INSERT INTO security_incidents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "incident-1",
        null,
        "equivocation",
        "sync",
        "document",
        "document-1",
        "organization-1",
        "{}",
        UPDATED_AT,
        UPDATED_AT,
        2,
      ],
    );
    const backup = await readBackupDatabase({ execSql: target.execSql });
    const tables = backup.tables.map((table) =>
      table.name === "security_incidents"
        ? {
            ...table,
            rows: table.rows.map((row) => ({ ...row, code: "unauthorized" })),
          }
        : table,
    );
    await expect(
      restoreBackupDatabase({ ...backup, tables, execSql: target.execSql }),
    ).rejects.toThrow("Backup conflicts with security incident");
    expect(
      (await readBackupDatabase({ execSql: target.execSql })).tables,
    ).toEqual(backup.tables);
  } finally {
    target.close();
  }
});

test("restore rechecks a terminal decision learned after preflight", async () => {
  const target = createNativeTestExecSql();
  const source = createNativeTestExecSql();
  try {
    for (const db of [source, target]) {
      for (const sql of schema) await db.execSql(sql);
    }
    await source.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
      ["document-1", "organization-1", HASH, HASH, UPDATED_AT],
    );
    const backup = await readBackupDatabase({ execSql: source.execSql });
    await preflightSecurityAnchorRestore({
      execSql: target.execSql,
      restoredTables: backup.tables,
    });
    await target.execSql(
      "INSERT INTO document_purge_checkpoints VALUES (?, ?, ?, ?, ?)",
      ["document-1", "organization-1", HASH, "b".repeat(64), UPDATED_AT],
    );
    await expect(
      restoreBackupDatabase({ ...backup, execSql: target.execSql }),
    ).rejects.toThrow("Backup conflicts with document purge checkpoint");
    expect(
      await target.execSql(
        "SELECT purge_event_hash FROM document_purge_checkpoints",
      ),
    ).toEqual([{ purge_event_hash: "b".repeat(64) }]);
  } finally {
    source.close();
    target.close();
  }
});

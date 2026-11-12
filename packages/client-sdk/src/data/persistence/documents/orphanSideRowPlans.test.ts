import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createExecSql, type ExecSql } from "../../sqlite/sqlSchema";
import { sqlDocumentsPersistence } from "./documentsPersistence";
import { deleteOrphanedDocumentSideRows } from "./internal/orphanSideRows";

const OLD = "2026-07-01T00:00:00.000Z";
const NOW = new Date("2026-07-30T12:00:00.000Z");
const TABLES = [
  "document_pending_attachments",
  "document_attachment_blob_projection",
] as const;

async function seedAttachments(execSql: ExecSql): Promise<void> {
  await sqlDocumentsPersistence.ensureSchema(execSql);
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id, updated_at) VALUES
      ('documents', 'shared', 'remote', ?), ('container-metadata', 'shared', NULL, ?),
      ('container-metadata', 'metadata-only', NULL, ?)`,
    [OLD, OLD, OLD],
  );
  // Tombstone visibility does not remove canonical ownership of attachments.
  await execSql(
    `INSERT INTO document_projection
      (local_id, document_id, container_id, updated_at)
     VALUES ('shared', 'remote', 'hidden-folder', ?)`,
    [OLD],
  );
  await execSql(
    `INSERT INTO container_document_tombstone_holds
      (document_id, container_id, hidden, tombstoned_at, updated_at) VALUES
      ('remote', 'hidden-folder', 1, ?, ?),
      ('remote', 'refuted-folder', 0, ?, ?)`,
    [OLD, OLD, OLD, OLD],
  );
  for (const id of ["shared", "metadata-only", "orphan", "fresh"]) {
    const at = id === "fresh" ? NOW.toISOString() : OLD;
    await execSql(
      `INSERT INTO document_pending_attachments
        (local_id, slot_id, name, storage_key, byte_length, content_sha256, created_at)
       VALUES (?, 'slot', 'file', ?, 1, '', ?)`,
      [id, `${id}-pending`, at],
    );
    await execSql(
      `INSERT INTO document_attachment_blob_projection
        (local_id, slot_id, storage_key, byte_length, content_sha256, updated_at)
       VALUES (?, 'slot', ?, 1, '', ?)`,
      [id, `${id}-local`, at],
    );
  }
}

// Read the actual WASM schema, not just the Drizzle declarations: NULL on
// either side would change NOT IN's equivalence to the old NOT EXISTS.
test("attachment anti-join operands are NOT NULL in SQLite", async () => {
  const f = await createTestExecSql("orphan-anti-join-nullability");
  try {
    await seedAttachments(f.execSql);
    for (const table of ["documents", ...TABLES]) {
      expect(
        await f.execSql(
          `SELECT "notnull" FROM pragma_table_info(?) WHERE name = 'local_id'`,
          [table],
        ),
      ).toEqual([{ notnull: 1 }]);
      await expect(
        f.execSql(`UPDATE ${table} SET local_id = NULL`),
      ).rejects.toThrow(/NOT NULL constraint failed/);
    }
  } finally {
    f.close();
  }
});

test("attachment sweep materializes any-kind IDs once without correlated document scans", async () => {
  const f = await createTestExecSql("orphan-anti-join-plan");
  const statements: Array<{ sql: string; bind: Parameters<ExecSql>[1] }> = [];
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      if (
        sql.startsWith("select") &&
        TABLES.some((t) => sql.includes(`from "${t}"`))
      )
        statements.push({ sql, bind });
      return {
        rows: await f.execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  });
  try {
    await seedAttachments(execSql);
    const expected = await Promise.all(
      TABLES.map((table) =>
        f.execSql(
          `SELECT a.storage_key FROM ${table} a WHERE a.local_id = 'fresh'
        OR EXISTS (SELECT 1 FROM documents d WHERE d.local_id = a.local_id)
       ORDER BY a.storage_key`,
        ),
      ),
    );
    expect(await deleteOrphanedDocumentSideRows(execSql, { now: NOW })).toBe(
      false,
    );
    for (const [index, table] of TABLES.entries()) {
      const remaining = await f.execSql(
        `SELECT storage_key FROM ${table} ORDER BY storage_key`,
      );
      expect(expected[index]).toEqual(remaining);
      expect(remaining).toHaveLength(3);
    }
    expect(
      await f.execSql(
        "SELECT storage_key FROM document_orphan_blob_reclaims ORDER BY storage_key",
      ),
    ).toEqual([
      { storage_key: "orphan-local" },
      { storage_key: "orphan-pending" },
    ]);
    // No aged orphans remain: neither live duplicate IDs nor metadata-only
    // attachments may be removed by a second pass.
    expect(await deleteOrphanedDocumentSideRows(execSql, { now: NOW })).toBe(
      false,
    );
    expect(statements).toHaveLength(4);
    for (const [index, table] of TABLES.entries()) {
      expect(expected[index]).toEqual(
        await f.execSql(
          `SELECT storage_key FROM ${table} ORDER BY storage_key`,
        ),
      );
    }
    for (const statement of statements) {
      const plan = await f.execSql(
        `EXPLAIN QUERY PLAN ${statement.sql}`,
        statement.bind,
      );
      const details = plan.map((row) => String(Reflect.get(row, "detail")));
      expect(details.some((detail) => detail.includes("CORRELATED"))).toBe(
        false,
      );
      expect(details).toContainEqual(expect.stringContaining("LIST SUBQUERY"));
    }
  } finally {
    f.close();
  }
});

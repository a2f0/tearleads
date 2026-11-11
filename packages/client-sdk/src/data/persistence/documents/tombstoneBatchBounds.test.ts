import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { captureStatements } from "../../../../test/helpers/statementCapture";
import {
  seedTombstoneBatch,
  seedTombstoneGuards,
  tombstoneAfter,
} from "../../../../test/helpers/tombstoneBatches";
import { SQLITE_BOUND_VARIABLE_BUDGET } from "../../sqlite/sqliteBindBudget";
import { applyContainerDocumentTombstones } from "./documentsPersistence";

for (const size of [199, 200]) {
  test(`tombstone apply repoints ${size} rows in bounded statements`, async () => {
    const db = await createTestExecSql("repoint-batch-boundary");
    const { execSql, statements } = captureStatements(db.execSql);
    try {
      const inputs = await seedTombstoneBatch(execSql, size);
      statements.length = 0;
      const summaries = await applyContainerDocumentTombstones(execSql, inputs);
      const writes = statements.filter(({ sql }) =>
        /^update "document_projection"/i.test(sql),
      );
      console.info(
        JSON.stringify({
          operation: "repoint-boundary",
          size,
          statements: statements.length,
          writeBinds: writes.map((row) => row.binds),
        }),
      );
      expect(writes).toHaveLength(Math.ceil(size / 199));
      expect(
        Math.max(...statements.map((row) => row.binds)),
      ).toBeLessThanOrEqual(SQLITE_BOUND_VARIABLE_BUDGET);
      expect(summaries).toHaveLength(size);
      expect(
        await db.execSql(
          "SELECT local_id FROM document_projection ORDER BY updated_at DESC, local_id DESC",
        ),
      ).toEqual(summaries.map((row) => ({ local_id: row.id })));
      expect(
        await db.execSql(
          "SELECT document_id, container_id FROM document_container_projection ORDER BY document_id",
        ),
      ).toEqual(
        inputs.map((row) => ({
          document_id: row.documentId,
          container_id: "survivor",
        })),
      );
      expect(
        summaries.every(
          (row) =>
            row.containerId === "survivor" && row.updatedAt >= tombstoneAfter,
        ),
      ).toBe(true);
    } finally {
      await db.close();
    }
  });
}

test("complete large tombstone apply bounds placement guards and preserves effects", async () => {
  const db = await createTestExecSql("large-tombstone-apply");
  const { execSql, statements } = captureStatements(db.execSql);
  try {
    const inputs = await seedTombstoneBatch(execSql, 1001);
    await db.execSql(
      `INSERT INTO container_document_tombstone_holds (document_id, container_id, tombstoned_at, updated_at)
       SELECT document_id, 'removed', ?, ? FROM documents`,
      [tombstoneAfter, tombstoneAfter],
    );
    await seedTombstoneGuards(db.execSql);
    const beforeIntents = await db.execSql("SELECT * FROM local_intents");
    const beforeEpochs = await db.execSql(
      "SELECT local_id, access_epoch FROM documents ORDER BY local_id",
    );
    // An exact pair repeats at the end; another pair repeats a remote id.
    const first = inputs[2];
    if (!first) throw new Error("Missing input");
    inputs.push({ ...first, containerId: "listing-only" }, { ...first });
    statements.length = 0;
    const summaries = await applyContainerDocumentTombstones(execSql, inputs);
    expect(summaries).toHaveLength(1001);
    const expected = await db.execSql(
      `SELECT local_id, document_id, container_id, updated_at FROM document_projection
       WHERE container_id = 'survivor' ORDER BY updated_at DESC, local_id DESC`,
    );
    expect(expected).toEqual(
      summaries.map((row) => ({
        local_id: row.id,
        document_id: row.documentId,
        container_id: row.containerId,
        updated_at: row.updatedAt,
      })),
    );
    // These IDs disagree under JS UTF-16 order and SQLite BINARY order.
    expect(summaries.findIndex((row) => row.id === "\u{10000}")).toBeLessThan(
      summaries.findIndex((row) => row.id === "\uE000"),
    );
    expect(await db.execSql("SELECT * FROM local_intents")).toEqual(
      beforeIntents,
    );
    expect(
      await db.execSql(
        "SELECT document_id FROM container_document_tombstone_holds ORDER BY document_id",
      ),
    ).toEqual([
      { document_id: "document-0999" },
      { document_id: "document-1000" },
    ]);
    expect(
      await db.execSql(
        "SELECT local_id, access_epoch FROM documents ORDER BY local_id",
      ),
    ).toEqual(beforeEpochs);
    expect(
      await db.execSql(
        "SELECT local_id FROM document_projection WHERE container_id = 'removed' ORDER BY local_id",
      ),
    ).toEqual([
      { local_id: "local-0999" },
      { local_id: "local-1000" },
      { local_id: "stale-alias" },
    ]);
    expect(
      await db.execSql(
        "SELECT document_id, container_id FROM document_container_projection WHERE container_id <> 'survivor' ORDER BY document_id, container_id",
      ),
    ).toEqual([
      { document_id: "document-0999", container_id: "listing-only" },
      { document_id: "document-0999", container_id: "removed" },
      { document_id: "document-1000", container_id: "listing-only" },
      { document_id: "document-1000", container_id: "removed" },
    ]);
    expect(summaries.every((row) => row.updatedAt >= tombstoneAfter)).toBe(
      true,
    );
    const guards = statements.filter(
      ({ sql }) =>
        /^select /i.test(sql) &&
        (sql.includes('from "local_intents"') ||
          sql.includes('"access_epoch"')),
    );
    const guardBinds = guards.map(({ binds }) => binds);
    console.info(
      JSON.stringify({
        operation: "large-tombstone-apply",
        statements: statements.length,
        guardBinds,
        maxBinds: Math.max(...statements.map((row) => row.binds)),
      }),
    );
    expect(guards.some(({ sql }) => sql.includes('from "local_intents"'))).toBe(
      true,
    );
    expect(guards.some(({ sql }) => sql.includes('"access_epoch"'))).toBe(true);
    expect(Math.max(...guardBinds)).toBeLessThanOrEqual(
      SQLITE_BOUND_VARIABLE_BUDGET,
    );
    const readbacks = statements.filter(({ sql }) =>
      sql.includes('left join "documents"'),
    );
    expect(readbacks.length).toBeGreaterThan(0);
    console.info(
      JSON.stringify({
        operation: "tombstone-result-readback",
        binds: readbacks.map((row) => row.binds),
      }),
    );
    expect(Math.max(...readbacks.map((row) => row.binds))).toBeLessThanOrEqual(
      SQLITE_BOUND_VARIABLE_BUDGET,
    );
    expect(Math.max(...statements.map((row) => row.binds))).toBeLessThanOrEqual(
      SQLITE_BOUND_VARIABLE_BUDGET,
    );
    expect(statements.filter(({ sql }) => /^begin/i.test(sql))).toHaveLength(1);
    expect(statements.filter(({ sql }) => /^commit/i.test(sql))).toHaveLength(
      1,
    );
  } finally {
    await db.close();
  }
});

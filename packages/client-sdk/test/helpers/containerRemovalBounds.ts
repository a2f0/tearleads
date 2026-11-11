import assert from "node:assert/strict";
import { DOCUMENTS_APP_KIND } from "../../src/data/documents/documentConstants";
import { sqlContainerContentsPersistence as persistence } from "../../src/data/persistence/container-contents/containerContentsPersistence";
import { createExecSql, type ExecSql } from "../../src/data/sqlite/sqlSchema";

const before = "2026-01-01T00:00:00.000Z";
const removedAt = "2026-01-02T00:00:00.000Z";
const newer = "2026-01-03T00:00:00.000Z";

/** One populated container: local-only documents plus three remote documents. */
export async function runContainerRemovalBounds(
  rawExecSql: ExecSql,
  count: number,
) {
  // Assert every selected value in column order without copying native
  // SQLite's null-prototype object rows into a second set of objects.
  const readRows = (sql: string) =>
    rawExecSql(sql, undefined, { rowMode: "array" });
  let measured = false;
  let statements = 0;
  let selected = 0;
  const updatedIds: unknown[] = [];
  const execSql = createExecSql({
    async exec({ sql, bind, rowMode }) {
      if (measured) {
        statements += 1;
        if (/^update "document_projection"/i.test(sql) && Array.isArray(bind)) {
          updatedIds.push(bind.at(-1));
        }
      }
      const rows =
        rowMode === "array"
          ? await rawExecSql(sql, bind, { rowMode: "array" })
          : await rawExecSql(sql, bind);
      if (
        measured &&
        /^select "container_id", "document_id", "local_id", "updated_at" from "document_projection"/i.test(
          sql,
        )
      ) {
        selected += rows.length;
      }
      return { rows };
    },
  });
  await persistence.ensureSchema(execSql);
  await rawExecSql(
    "INSERT INTO containers (id, organization_id, local_created_at, local_updated_at) VALUES ('removed', 'organization', ?, ?)",
    [before, before],
  );
  await rawExecSql(
    `WITH RECURSIVE ids(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM ids WHERE i+1 < ?)
     INSERT INTO documents (app_kind, local_id, document_id, updated_at)
     SELECT ?, printf('local-%06d', i),
       CASE WHEN i IN (0, 1, ?) THEN printf('document-%06d', i) ELSE NULL END, ? FROM ids`,
    [count, DOCUMENTS_APP_KIND, count - 1, before],
  );
  await rawExecSql(
    `INSERT INTO document_projection (local_id, document_id, container_id, updated_at)
     SELECT local_id, document_id, 'removed', CASE WHEN local_id = 'local-000001' THEN ? ELSE ? END FROM documents`,
    [newer, before],
  );
  for (const container of ["removed", "z-survivor", "a-survivor"]) {
    await rawExecSql(
      `INSERT INTO document_container_projection (document_id, container_id, updated_at)
       SELECT document_id, ?, ? FROM documents WHERE document_id IS NOT NULL
         AND (document_id <> ? OR ? = 'removed')`,
      [
        container,
        before,
        `document-${String(count - 1).padStart(6, "0")}`,
        container,
      ],
    );
  }
  await rawExecSql(
    `INSERT INTO container_document_tombstone_holds (document_id, container_id, tombstoned_at, updated_at)
     SELECT document_id, container_id, ?, ? FROM document_container_projection`,
    [before, before],
  );
  const expectedOrder = await readRows(
    "SELECT local_id FROM document_projection WHERE container_id IN ('removed')",
  );
  measured = true;
  try {
    assert.deepEqual(
      await persistence.deleteContainers(execSql, [
        { containerId: "removed", reason: "deleted", updatedAt: removedAt },
      ]),
      ["removed"],
    );
  } catch (error) {
    measured = false;
    // Preserve the real failing path and its rollback, not a spread-only probe.
    assert.deepEqual(await readRows("SELECT id FROM containers"), [
      ["removed"],
    ]);
    assert.deepEqual(
      await readRows(
        "SELECT count(*) AS n FROM document_projection WHERE container_id = 'removed'",
      ),
      [[count]],
    );
    assert.deepEqual(
      await persistence.loadContainerHydrationTombstones(execSql),
      [],
    );
    throw new Error(
      `Removal failed after selecting ${selected} rows in ${statements} statements`,
      { cause: error },
    );
  }
  measured = false;
  assert.equal(selected, count);
  assert.deepEqual(
    updatedIds,
    expectedOrder.map(([localId]) => localId),
  );
  assert.deepEqual(
    await readRows(
      "SELECT local_id, container_id, organization_id, updated_at FROM document_projection ORDER BY local_id",
    ),
    Array.from({ length: count }, (_, index) => [
      `local-${String(index).padStart(6, "0")}`,
      index < 2 ? "a-survivor" : null,
      "organization",
      index === 1 ? newer : removedAt,
    ]),
  );
  const expectedLinks = ["document-000000", "document-000001"].flatMap(
    (documentId) =>
      ["a-survivor", "z-survivor"].map((containerId) => [
        documentId,
        containerId,
      ]),
  );
  assert.deepEqual(
    await readRows(
      "SELECT document_id, container_id FROM document_container_projection ORDER BY document_id, container_id",
    ),
    expectedLinks,
  );
  assert.deepEqual(
    await readRows(
      "SELECT document_id, container_id FROM container_document_tombstone_holds ORDER BY document_id, container_id",
    ),
    expectedLinks,
  );
  assert.deepEqual(await readRows("SELECT id FROM containers"), []);
  assert.deepEqual(await readRows("SELECT count(*) AS n FROM documents"), [
    [count],
  ]);
  assert.deepEqual(
    await persistence.loadContainerHydrationTombstones(execSql),
    [
      {
        containerId: "removed",
        generation: 1,
        reason: "deleted",
        updatedAt: removedAt,
      },
    ],
  );
  return { count, selected, statements, updates: updatedIds.length };
}

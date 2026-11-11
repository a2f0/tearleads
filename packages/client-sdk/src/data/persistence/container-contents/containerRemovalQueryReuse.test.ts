import { expect, spyOn, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import { DOCUMENTS_APP_KIND } from "../../documents/documentConstants";
import { documentProjection } from "../../sqlite/schema/documentProjectionSchema";
import { createExecSql, type ExecSql } from "../../sqlite/sqlSchema";
import { sqlContainerContentsPersistence as persistence } from "./containerContentsPersistence";

const before = "2026-01-01T00:00:00.000Z";
const removedAt = "2026-01-02T00:00:00.000Z";
const newer = "2026-01-03T00:00:00.000Z";
const organizations = ["org-a", null, "", "org-b"] as const;

function previousOrganization(index: number, id: string) {
  if (index === 1) return null;
  if (index === 2) return "";
  return `previous-${id}`;
}

async function createFixture() {
  const db = await createTestExecSql("removal-query-reuse");
  const updates: Array<{ sql: string; bind: unknown }> = [];
  const statements: string[] = [];
  const execSql = createExecSql({
    async exec({ sql, bind, rowMode }) {
      statements.push(sql);
      if (/^update "document_projection"/i.test(sql)) {
        updates.push({ sql, bind });
      }
      return {
        rows:
          rowMode === "array"
            ? await db.execSql(sql, bind, { rowMode: "array" })
            : await db.execSql(sql, bind),
      };
    },
  });
  try {
    await persistence.ensureSchema(execSql);
    for (const [index, organization] of organizations.entries()) {
      // Container attribution is NOT NULL; a missing container supplies the
      // absent-attribution path without relaxing the real schema.
      if (organization !== null) {
        await db.execSql(
          "INSERT INTO containers (id, organization_id, local_created_at, local_updated_at) VALUES (?, ?, ?, ?)",
          [`removed-${index}`, organization, before, before],
        );
      }
      for (const suffix of ["old", "new"]) {
        const id = `${index}-${suffix}`;
        const updatedAt = suffix === "new" ? newer : before;
        await db.execSql(
          "INSERT INTO documents (app_kind, local_id, document_id, updated_at) VALUES (?, ?, ?, ?)",
          [DOCUMENTS_APP_KIND, id, id, updatedAt],
        );
        await db.execSql(
          "INSERT INTO document_projection (local_id, document_id, container_id, organization_id, updated_at) VALUES (?, ?, ?, ?, ?)",
          [
            id,
            id,
            `removed-${index}`,
            previousOrganization(index, id),
            updatedAt,
          ],
        );
        for (const containerId of [
          `removed-${index}`,
          "z-survivor",
          "a-survivor",
        ]) {
          await db.execSql(
            "INSERT INTO document_container_projection (document_id, container_id, updated_at) VALUES (?, ?, ?)",
            [id, containerId, before],
          );
        }
      }
    }
    await db.execSql(
      "INSERT INTO container_document_tombstone_holds (document_id, container_id, tombstoned_at, updated_at) SELECT document_id, container_id, ?, ? FROM document_container_projection",
      [before, before],
    );
    statements.length = 0;
    return { db, execSql, updates, statements };
  } catch (error) {
    db.close();
    throw error;
  }
}

const removals = organizations.map((_, index) => ({
  containerId: `removed-${index}`,
  reason: "deleted" as const,
  updatedAt: removedAt,
}));

const withOrganization =
  'update "document_projection" set "container_id" = ?, "organization_id" = ?, "updated_at" = ? where "document_projection"."local_id" = ?';
const withoutOrganization =
  'update "document_projection" set "container_id" = ?, "updated_at" = ? where "document_projection"."local_id" = ?';

async function snapshot(execSql: ExecSql) {
  return {
    containers: await execSql("SELECT * FROM containers ORDER BY id"),
    documents: await execSql("SELECT * FROM documents ORDER BY local_id"),
    projections: await execSql(
      "SELECT * FROM document_projection ORDER BY local_id",
    ),
    links: await execSql(
      "SELECT * FROM document_container_projection ORDER BY document_id, container_id",
    ),
    holds: await execSql(
      "SELECT * FROM container_document_tombstone_holds ORDER BY document_id, container_id",
    ),
    tombstones: await persistence.loadContainerHydrationTombstones(execSql),
  };
}

// Count real query construction, not driver execution: the native fixture
// already caches SQLite statements. Every row must still execute its update.
test("removal builds each projection update shape once per transaction", async () => {
  // Identical IDs on independent connections must not share prepared queries.
  for (let run = 0; run < 2; run += 1) {
    const { db, execSql, updates } = await createFixture();
    const build = spyOn(SQLiteAsyncDialect.prototype, "buildUpdateQuery");
    try {
      const order = await db.execSql(
        "SELECT local_id FROM document_projection WHERE container_id IN ('removed-0', 'removed-1', 'removed-2', 'removed-3')",
      );
      const documents = await db.execSql(
        "SELECT * FROM documents ORDER BY local_id",
      );
      expect(await persistence.deleteContainers(execSql, removals)).toEqual(
        removals.map(({ containerId }) => containerId),
      );
      expect(updates).toEqual(
        order.map(({ local_id }) => {
          const id = String(local_id);
          const organization = organizations[Number(id[0])];
          const updatedAt = id.endsWith("new") ? newer : removedAt;
          return {
            sql: organization ? withOrganization : withoutOrganization,
            bind: organization
              ? ["a-survivor", organization, updatedAt, id]
              : ["a-survivor", updatedAt, id],
          };
        }),
      );
      expect(
        await db.execSql(
          "SELECT local_id, container_id, organization_id, updated_at FROM document_projection ORDER BY local_id",
        ),
      ).toEqual(
        organizations.flatMap((organization, index) =>
          ["new", "old"].map((suffix) => ({
            local_id: `${index}-${suffix}`,
            container_id: "a-survivor",
            organization_id:
              organization || previousOrganization(index, `${index}-${suffix}`),
            updated_at: suffix === "new" ? newer : removedAt,
          })),
        ),
      );
      expect(
        await db.execSql("SELECT * FROM documents ORDER BY local_id"),
      ).toEqual(documents);
      const expectedLinks = organizations.flatMap((_, index) =>
        ["new", "old"].flatMap((suffix) =>
          ["a-survivor", "z-survivor"].map((containerId) => ({
            document_id: `${index}-${suffix}`,
            container_id: containerId,
          })),
        ),
      );
      for (const table of [
        "document_container_projection",
        "container_document_tombstone_holds",
      ]) {
        expect(
          await db.execSql(
            `SELECT document_id, container_id FROM ${table} ORDER BY document_id, container_id`,
          ),
        ).toEqual(expectedLinks);
      }
      expect(await db.execSql("SELECT id FROM containers")).toEqual([]);
      expect(
        await persistence.loadContainerHydrationTombstones(execSql),
      ).toEqual(
        removals.map(({ containerId, reason, updatedAt }) => ({
          containerId,
          generation: 1,
          reason,
          updatedAt,
        })),
      );
      expect(
        build.mock.calls.filter(
          ([config]) => config.table === documentProjection,
        ),
      ).toHaveLength(2);
    } finally {
      build.mockRestore();
      db.close();
    }
  }
});

test("a later mixed-attribution update failure rolls back the complete removal", async () => {
  const { db, execSql, updates, statements } = await createFixture();
  try {
    const original = await snapshot(db.execSql);
    const order = await db.execSql(
      "SELECT local_id FROM document_projection WHERE container_id IN ('removed-0', 'removed-1', 'removed-2', 'removed-3')",
    );
    await db.execSql(`CREATE TRIGGER fail_projection BEFORE UPDATE ON document_projection
      WHEN NEW.local_id = '2-old'
      BEGIN SELECT RAISE(ABORT, 'projection update rejected'); END`);
    const failure = await persistence.deleteContainers(execSql, removals).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(
      String(failure instanceof Error ? failure.cause : failure),
    ).toContain("projection update rejected");
    const failedIndex = order.findIndex(({ local_id }) => local_id === "2-old");
    expect(failedIndex).toBeGreaterThan(0);
    expect(
      updates.map(({ bind }) => (Array.isArray(bind) ? bind.at(-1) : null)),
    ).toEqual(order.slice(0, failedIndex + 1).map(({ local_id }) => local_id));
    expect(statements.filter((sql) => /^rollback/i.test(sql))).toHaveLength(1);
    expect(statements.filter((sql) => /^commit/i.test(sql))).toHaveLength(0);
    expect(await snapshot(db.execSql)).toEqual(original);

    await db.execSql("DROP TRIGGER fail_projection");
    updates.length = 0;
    expect(await persistence.deleteContainers(execSql, removals)).toHaveLength(
      4,
    );
    expect(updates).toHaveLength(8);
  } finally {
    db.close();
  }
});

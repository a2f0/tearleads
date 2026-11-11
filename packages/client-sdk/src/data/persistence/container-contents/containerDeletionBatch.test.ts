import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { SQLITE_BOUND_VARIABLE_BUDGET } from "../../sqlite/sqliteBindBudget";
import { createExecSql } from "../../sqlite/sqlSchema";
import { sqlContainerContentsPersistence as persistence } from "./containerContentsPersistence";

test("removal guards and surviving links span every statement batch", async () => {
  const db = await createTestExecSql("container-removal-cross-batch");
  const now = "2026-01-03T00:00:00.000Z";
  const removals = Array.from({ length: 200 }, (_, index) => ({
    containerId: `container-${index}`,
    reason: "deleted" as const,
    updatedAt: now,
  }));
  try {
    await persistence.ensureSchema(db.execSql);
    for (const id of ["container-0", "container-199"]) {
      await db.execSql(
        "INSERT INTO containers (id, organization_id, local_created_at, local_updated_at) VALUES (?, 'organization', ?, ?)",
        [id, now, now],
      );
    }
    for (const id of ["container-0", "container-199", "survivor"]) {
      await db.execSql(
        "INSERT INTO document_container_projection (document_id, container_id, updated_at) VALUES ('document', ?, ?)",
        [id, now],
      );
    }
    await db.execSql(
      "INSERT INTO document_projection (local_id, document_id, container_id, updated_at) VALUES ('local', 'document', 'container-0', ?)",
      [now],
    );
    expect(
      await persistence.deleteContainers(db.execSql, removals, {
        expectedContainers: [
          { containerId: "container-199", expectedContainer: null },
        ],
      }),
    ).toEqual([]);
    expect(await db.execSql("SELECT id FROM containers")).toHaveLength(2);
    expect(
      await persistence.loadContainerHydrationTombstones(db.execSql),
    ).toEqual([]);
    await persistence.deleteContainers(db.execSql, removals);
    expect(
      await db.execSql(
        "SELECT container_id, organization_id, updated_at FROM document_projection",
      ),
    ).toEqual([
      {
        container_id: "survivor",
        organization_id: "organization",
        updated_at: now,
      },
    ]);
    expect(
      await db.execSql(
        "SELECT container_id FROM document_container_projection",
      ),
    ).toEqual([{ container_id: "survivor" }]);
    expect(await db.execSql("SELECT id FROM containers")).toEqual([]);
  } finally {
    await db.close();
  }
});

for (const discoveryOnly of [false, true]) {
  for (const size of [199, 200, 1001]) {
    test(`container removal bounds ${size} rows (discovery=${discoveryOnly})`, async () => {
      const database = await createTestExecSql("container-removal-budget");
      const statements: Array<{ sql: string; binds: number }> = [];
      const execSql = createExecSql({
        async exec({ sql, bind, rowMode }) {
          statements.push({
            sql,
            binds: Array.isArray(bind)
              ? bind.length
              : Object.keys(bind ?? {}).length,
          });
          return {
            rows:
              rowMode === "array"
                ? await database.execSql(sql, bind, { rowMode: "array" })
                : await database.execSql(sql, bind),
          };
        },
      });
      const removals = Array.from({ length: size }, (_, index) => ({
        containerId: `container-${index}`,
        reason: "deleted" as const,
        updatedAt: "2026-01-03T00:00:00.000Z",
      }));
      try {
        await persistence.ensureSchema(execSql);
        statements.length = 0;
        expect(
          await persistence.deleteContainers(execSql, removals, {
            discoveryOnly,
          }),
        ).toEqual(removals.map((row) => row.containerId));
        expect(
          statements.filter(({ sql }) => /^begin/i.test(sql)),
        ).toHaveLength(1);
        expect(
          statements.filter(({ sql }) => /^commit/i.test(sql)),
        ).toHaveLength(1);
        expect(
          Math.max(...statements.map(({ binds }) => binds)),
        ).toBeLessThanOrEqual(SQLITE_BOUND_VARIABLE_BUDGET);
        expect(
          await persistence.loadContainerHydrationTombstones(execSql),
        ).toHaveLength(size);
      } finally {
        await database.close();
      }
    });
  }
}

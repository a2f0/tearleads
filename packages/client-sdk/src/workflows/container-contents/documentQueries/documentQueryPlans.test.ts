import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { createExecSql, type ExecSql } from "../../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import { saveTestDocument } from "./documentQueries.testFixtures";
import { createContainerDocumentQueriesFromRuntime } from "./index";

interface CapturedStatement {
  bind: Parameters<ExecSql>[1];
  sql: string;
}

// Plans every listing statement production sends. Each assertion names the
// index that turns a whole-table scan into a search.
test("folder listings search links, child folders, and queued history by index", async () => {
  const f = await createTestExecSql("container-listing-plans");
  const statements: CapturedStatement[] = [];
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      if (sql.includes("document_container_projection linked"))
        statements.push({ bind, sql });
      return {
        rows: await f.execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  });
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    // One listed document, so each listing reads its window after its count.
    await saveTestDocument({
      containerId: "folder",
      documentId: "remote-note",
      execSql: f.execSql,
      id: "note",
      title: "Note",
      updatedAt: "2026-05-03T00:00:00.000Z",
    });
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    await queries.listContainerItemWindow({
      containerId: "folder",
      limit: 10,
      offset: 0,
      sort: { direction: "asc", key: "name" },
    });
    await queries.listContainerDocumentSidebarWindow({
      containerId: "folder",
      limit: 10,
      offset: 0,
    });
    expect(statements.length).toBeGreaterThanOrEqual(4);

    for (const statement of statements) {
      const plan = await f.execSql(
        `EXPLAIN QUERY PLAN ${statement.sql}`,
        statement.bind,
      );
      const details = plan.map((row) => String(Reflect.get(row, "detail")));
      expect(details).toContainEqual(
        expect.stringContaining(
          "SEARCH linked USING COVERING INDEX document_container_projection_container_idx (container_id=?)",
        ),
      );
      expect(details).toContainEqual(
        expect.stringContaining(
          "SEARCH document_history_updates USING INDEX document_history_updates_queued_scope_idx (app_kind=?)",
        ),
      );
      expect(
        details.filter((detail) =>
          /^SCAN (linked|c|document_history_updates)\b/.test(detail),
        ),
      ).toEqual([]);
      if (statement.sql.includes("c.parent_id = ?"))
        expect(details).toContainEqual(
          expect.stringContaining(
            "SEARCH c USING INDEX containers_parent_idx (parent_id=?)",
          ),
        );
    }
  } finally {
    f.close();
  }
});

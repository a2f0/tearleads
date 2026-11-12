import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { createExecSql, type ExecSql } from "../../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import { hydratedProjectionSql } from "./hydrationSql";
import { createContainerDocumentQueriesFromRuntime } from "./index";
import {
  getOrphanedDocumentQueryBind,
  getOrphanedDocumentWhereSql,
} from "./orphanedDocumentSql";

const AT = "2026-07-01T00:00:00.000Z";
type Placement = "hidden" | "refuted" | "visible";
interface Candidate {
  containerId: string | null;
  primaryHold?: Placement;
  otherLink?: Placement;
  organizationId?: string | null;
  kind?: string;
  shell?: boolean;
  localOnly?: boolean;
}

async function seedCandidate(execSql: ExecSql, c: Candidate): Promise<void> {
  const documentId = c.localOnly ? null : "remote";
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id, snapshot_end_version, updated_at)
     VALUES ('documents', 'candidate', ?, ?, ?)`,
    [documentId, c.shell ? "" : "hydrated", AT],
  );
  await execSql(
    `INSERT INTO document_projection
      (local_id, document_id, container_id, organization_id, document_kind, updated_at)
     VALUES ('candidate', ?, ?, ?, ?, ?)`,
    [
      documentId,
      c.containerId,
      c.organizationId === undefined ? "org" : c.organizationId,
      c.kind ?? "note",
      AT,
    ],
  );
  for (const [containerId, state] of [
    [c.containerId, c.primaryHold],
    ["other", c.otherLink],
  ] as const) {
    if (!containerId || !state || !documentId) continue;
    await execSql(
      "INSERT INTO document_container_projection (document_id, container_id, updated_at) VALUES (?, ?, ?)",
      [documentId, containerId, AT],
    );
    if (state !== "visible")
      await execSql(
        `INSERT INTO container_document_tombstone_holds
        (document_id, container_id, tombstoned_at, updated_at, hidden)
       VALUES (?, ?, ?, ?, ?)`,
        [documentId, containerId, AT, AT, state === "hidden" ? 1 : 0],
      );
  }
}

async function baselineExists(
  execSql: ExecSql,
  organizationId: string | null,
): Promise<boolean> {
  const rows = await execSql(
    `SELECT 1 FROM document_projection d
     WHERE ${hydratedProjectionSql("d.local_id", "documents")}
       AND ${getOrphanedDocumentWhereSql({ documentIdSql: "d.document_id", projectionAlias: "d" })}
     LIMIT 1`,
    getOrphanedDocumentQueryBind(organizationId),
  );
  return rows.length > 0;
}

const cases: ReadonlyArray<{
  name: string;
  candidate: Candidate | null;
  found: boolean;
}> = [
  { name: "empty", candidate: null, found: false },
  {
    name: "visible primary",
    candidate: { containerId: "folder" },
    found: false,
  },
  {
    name: "unplaced local",
    candidate: { containerId: null, localOnly: true },
    found: true,
  },
  { name: "unplaced remote", candidate: { containerId: null }, found: true },
  {
    name: "hidden primary",
    candidate: { containerId: "folder", primaryHold: "hidden" },
    found: true,
  },
  {
    name: "refuted primary",
    candidate: { containerId: "folder", primaryHold: "refuted" },
    found: false,
  },
  {
    name: "hidden hold for another primary placement",
    candidate: { containerId: "folder", otherLink: "hidden" },
    found: false,
  },
  {
    name: "refuted primary with another hidden placement",
    candidate: {
      containerId: "folder",
      primaryHold: "refuted",
      otherLink: "hidden",
    },
    found: false,
  },
  {
    name: "all placements hidden",
    candidate: {
      containerId: "folder",
      primaryHold: "hidden",
      otherLink: "hidden",
    },
    found: true,
  },
  {
    name: "visible other link",
    candidate: {
      containerId: "folder",
      primaryHold: "hidden",
      otherLink: "visible",
    },
    found: false,
  },
  {
    name: "refuted other link",
    candidate: {
      containerId: "folder",
      primaryHold: "hidden",
      otherLink: "refuted",
    },
    found: false,
  },
  {
    name: "unplaced with visible link",
    candidate: { containerId: null, otherLink: "visible" },
    found: false,
  },
  {
    name: "unplaced with hidden link",
    candidate: { containerId: null, otherLink: "hidden" },
    found: true,
  },
  {
    name: "null organization",
    candidate: { containerId: null, organizationId: null },
    found: true,
  },
  {
    name: "empty organization",
    candidate: {
      containerId: "folder",
      primaryHold: "hidden",
      organizationId: "",
    },
    found: true,
  },
  {
    name: "foreign unplaced",
    candidate: { containerId: null, organizationId: "foreign" },
    found: false,
  },
  {
    name: "foreign held",
    candidate: {
      containerId: "folder",
      primaryHold: "hidden",
      organizationId: "foreign",
    },
    found: false,
  },
  {
    name: "hidden kind unplaced",
    candidate: { containerId: null, kind: "organization_profile" },
    found: false,
  },
  {
    name: "hidden kind held",
    candidate: {
      containerId: "folder",
      primaryHold: "hidden",
      kind: "organization_profile",
    },
    found: false,
  },
  {
    name: "unhydrated unplaced",
    candidate: { containerId: null, shell: true },
    found: false,
  },
  {
    name: "unhydrated held",
    candidate: { containerId: "folder", primaryHold: "hidden", shell: true },
    found: false,
  },
];

test.each(cases)(
  "orphan existence preserves $name",
  async ({ candidate, found }) => {
    const f = await createTestExecSql("orphan-existence-equivalence");
    try {
      await defaultContainerContentsPersistence.ensureSchema(f.execSql);
      await sqlDocumentsPersistence.ensureSchema(f.execSql);
      if (candidate) await seedCandidate(f.execSql, candidate);
      const queries = createContainerDocumentQueriesFromRuntime({
        infra: { execSql: f.execSql },
      });
      expect(await baselineExists(f.execSql, "org")).toBe(found);
      expect(
        await queries.hasOrphanedDocuments({ currentOrganizationId: "org" }),
      ).toBe(found);
      expect(
        await queries.hasOrphanedDocuments({ currentOrganizationId: null }),
      ).toBe(await baselineExists(f.execSql, null));
    } finally {
      f.close();
    }
  },
);

test("orphan existence drives unplaced rows from the orphan index and held rows from holds", async () => {
  const f = await createTestExecSql("orphan-existence-plan");
  const statements: Array<{ sql: string; bind: Parameters<ExecSql>[1] }> = [];
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      if (sql.includes(" AS found")) statements.push({ sql, bind });
      return {
        rows: await f.execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  });
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await execSql(
      `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i + 1 FROM n WHERE i < 512)
       INSERT INTO document_projection (local_id, document_id, container_id, organization_id, updated_at)
       SELECT 'placed-' || i, 'remote-' || i, 'folder', 'org', ? FROM n`,
      [AT],
    );
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    expect(
      await queries.hasOrphanedDocuments({ currentOrganizationId: "org" }),
    ).toBe(false);
    await seedCandidate(execSql, {
      containerId: "folder",
      primaryHold: "hidden",
    });
    expect(
      await queries.hasOrphanedDocuments({ currentOrganizationId: "org" }),
    ).toBe(true);
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      const rows = await f.execSql(
        `EXPLAIN QUERY PLAN ${statement.sql}`,
        statement.bind,
      );
      const details = rows.map((row) => String(Reflect.get(row, "detail")));
      expect(
        details.filter(
          (detail) =>
            /^SCAN d\b/.test(detail) &&
            !detail.includes("document_projection_orphan_organization_idx"),
        ),
      ).toEqual([]);
      expect(details).toContainEqual(
        expect.stringContaining("document_projection_orphan_organization_idx"),
      );
      expect(details).toContainEqual(
        expect.stringMatching(/^SCAN primary_hold\b/),
      );
      expect(details).toContainEqual(
        expect.stringContaining(
          "SEARCH d USING INDEX document_projection_document_idx (document_id=?)",
        ),
      );
      expect(details).toContainEqual(
        expect.stringContaining(
          "SEARCH hydration USING INDEX sqlite_autoindex_documents_1 (app_kind=? AND local_id=?)",
        ),
      );
    }
  } finally {
    f.close();
  }
});

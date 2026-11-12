import { expect, test } from "bun:test";
import {
  citationDatabase,
  entry,
  NOW,
  ORGANIZATION,
  remember,
} from "../../../../test/helpers/verifiedCitationReads";
import { pendingDocumentDiscoveries } from "../../sqlite/schema/documentDiscoveryEvidenceSchema";
import { documentContainerProjection } from "../../sqlite/schema/documentProjectionSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { createExecSql } from "../../sqlite/sqlSchema";
import { citedObjects, targetOrganization } from "./citationScope";

for (const engine of ["native", "wasm"] as const)
  test(`${engine} organization sources share one indexed statement`, async () => {
    const fixture = await citationDatabase(engine);
    try {
      await fixture.container("root");
      await remember(fixture.execSql, [
        entry("root", 1, 1),
        entry("doc", 1, 2, "document"),
      ]);
      fixture.statements.length = 0;
      expect(
        await targetOrganization(fixture.db, { kind: "document", id: "doc" }, [
          { kind: "document", id: "doc" },
          { kind: "container", id: "root" },
        ]),
      ).toBe(ORGANIZATION);
      expect(fixture.statements).toHaveLength(1);
      const plans = await fixture.plans();
      const details = plans.flatMap(({ plan }) =>
        plan.map((row) => String(Reflect.get(row, "detail"))),
      );
      expect(
        details.filter((detail) =>
          detail.includes(
            "SEARCH verified_access_manifest_bundles USING INDEX verified_access_manifest_bundles_object_idx",
          ),
        ),
      ).toHaveLength(2);
      expect(details).toContain("MULTI-INDEX OR");
      console.info(
        "citation-organization-plan",
        JSON.stringify({ engine, plans }),
      );
    } finally {
      fixture.close();
    }
  });

test("placement union retains source ordinal before walking cycles and missing parents", async () => {
  const fixture = await citationDatabase();
  try {
    await fixture.container("z-link", "cycle");
    await fixture.container("cycle", "z-link");
    await fixture.container("a-pending", "missing");
    await fixture.container("m-metadata", null, ORGANIZATION, "doc");
    await fixture.db
      .insert(documentContainerProjection)
      .values({ documentId: "doc", containerId: "z-link", updatedAt: NOW })
      .run();
    await fixture.db
      .insert(pendingDocumentDiscoveries)
      .values({
        documentId: "doc",
        containerId: "a-pending",
        accessEpoch: 1,
        generation: 1,
        inputJson: "{}",
      })
      .run();
    fixture.statements.length = 0;
    const reordered = createExecSql({
      exec: async ({ sql, bind, rowMode }) => {
        const rows = await fixture.execSql(
          sql,
          bind,
          rowMode ? { rowMode } : undefined,
        );
        return {
          rows:
            sql.includes('from "document_container_projection"') &&
            sql.includes("union all")
              ? [...rows].reverse()
              : rows,
        };
      },
    });
    expect(
      await citedObjects(getClientSQLitePersistenceRuntime(reordered).db, {
        kind: "document",
        id: "doc",
      }),
    ).toEqual([
      { kind: "document", id: "doc" },
      ...["z-link", "cycle", "a-pending", "missing", "m-metadata"].map(
        (id) => ({ kind: "container", id }),
      ),
    ]);
    const placementReads = fixture.statements.filter(
      ({ sql }) => !sql.startsWith('select "parent_id"'),
    );
    expect(placementReads).toHaveLength(1);
  } finally {
    fixture.close();
  }
});

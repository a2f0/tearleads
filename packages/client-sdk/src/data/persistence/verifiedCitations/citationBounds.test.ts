import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  citationDatabase,
  entry,
  hash,
  level,
  NOW,
  ORGANIZATION,
  remember,
} from "../../../../test/helpers/verifiedCitationReads";
import { containers } from "../../sqlite/schema/containerSchema";
import { documentContainerProjection } from "../../sqlite/schema/documentProjectionSchema";
import { verifiedAccessManifestBundles as bundles } from "../../sqlite/schema/verifiedManifestBundleSchema";
import { loadVerifiedManifestCitations } from "../verifiedManifestBundlePersistence";

test("caller limits cannot widen the protocol JSON bound", async () => {
  const fixture = await citationDatabase();
  try {
    await fixture.container("root");
    await remember(
      fixture.execSql,
      Array.from({ length: 60 }, (_, i) => entry("root", i + 1, i + 1)),
    );
    for (const limit of [1000, Number.POSITIVE_INFINITY]) {
      fixture.statements.length = 0;
      expect(
        await loadVerifiedManifestCitations(
          fixture.execSql,
          { kind: "container", id: "root" },
          limit,
        ),
      ).toHaveLength(48);
      expect(readStats(fixture).maxJsonRows).toBeLessThanOrEqual(48);
    }
    for (const limit of [0, -1, Number.NaN])
      expect(
        await loadVerifiedManifestCitations(
          fixture.execSql,
          { kind: "container", id: "root" },
          limit,
        ),
      ).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("damage cleanup keeps every statement within the bind budget", async () => {
  const fixture = await citationDatabase();
  try {
    await remember(
      fixture.execSql,
      Array.from({ length: 1024 }, (_, i) => ({
        kekLevel: level(`k${i}`),
        organizationId: ORGANIZATION,
      })),
    );
    await fixture.db.update(bundles).set({ bundleDigest: "damaged" }).run();
    fixture.statements.length = 0;
    expect(
      await loadVerifiedManifestCitations(fixture.execSql, {
        kind: "container",
        id: "missing",
        listing: { organizationId: ORGANIZATION, parentId: null },
      }),
    ).toEqual([]);
    const stats = readStats(fixture);
    console.info("citation-damage-bounds", JSON.stringify(stats));
    expect(stats.maxBinds).toBeLessThanOrEqual(999);
    expect(stats.maxJsonRows).toBeLessThanOrEqual(48);
    expect(await fixture.db.select().from(bundles)).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("damaged recent rows replay the original selection window", async () => {
  const fixture = await citationDatabase();
  try {
    await fixture.container("root");
    await remember(fixture.execSql, [
      entry("root", 1, 100),
      ...Array.from({ length: 4 }, (_, i) => entry("other", i + 1, i + 1)),
    ]);
    for (const index of [1, 2])
      await fixture.db
        .update(bundles)
        .set({ bundleDigest: "damaged" })
        .where(eq(bundles.manifestHash, hash(index)))
        .run();
    expect(
      await loadVerifiedManifestCitations(
        fixture.execSql,
        { kind: "container", id: "root" },
        3,
      ),
    ).toEqual([
      entry("root", 1, 100).bundle,
      entry("other", 3, 3).bundle,
      entry("other", 4, 4).bundle,
    ]);
  } finally {
    fixture.close();
  }
});

function readStats(fixture: Awaited<ReturnType<typeof citationDatabase>>) {
  const reads = fixture.statements.filter(
    ({ sql }) => sql.startsWith("select ") && sql.includes('"bundle_json"'),
  );
  return {
    jsonRows: reads.reduce((n, { rows }) => n + rows, 0),
    maxJsonRows: Math.max(0, ...reads.map(({ rows }) => rows)),
    maxBinds: Math.max(
      0,
      ...fixture.statements.map(({ bind }) =>
        Array.isArray(bind) ? bind.length : 0,
      ),
    ),
  };
}

test("recent fill loads no more than 48 JSON rows in total without damage", async () => {
  const fixture = await citationDatabase();
  try {
    await fixture.container("root");
    await remember(fixture.execSql, [
      entry("root", 1, 1),
      ...Array.from({ length: 60 }, (_, i) => entry("other", i + 1, i + 2)),
    ]);
    fixture.statements.length = 0;
    const citations = await loadVerifiedManifestCitations(fixture.execSql, {
      kind: "container",
      id: "root",
    });
    expect(citations.map((row) => Reflect.get(row, "manifestHash"))).toEqual(
      Array.from({ length: 48 }, (_, i) => hash(i + 1)),
    );
    console.info("citation-read-bounds", JSON.stringify(readStats(fixture)));
    expect(readStats(fixture).jsonRows).toBeLessThanOrEqual(48);
  } finally {
    fixture.close();
  }
});

for (const count of [70, 520])
  test(`many placements keep JSON and binds bounded at ${count}`, async () => {
    const fixture = await citationDatabase();
    try {
      const ids = Array.from(
        { length: count },
        (_, i) => `c${String(i).padStart(4, "0")}`,
      );
      for (const id of ids) {
        await fixture.container(id);
        await fixture.db
          .insert(documentContainerProjection)
          .values({ documentId: "doc", containerId: id, updatedAt: NOW })
          .run();
      }
      await remember(
        fixture.execSql,
        ids.map((id) => ({
          kekLevel: level(id),
          organizationId: ORGANIZATION,
        })),
      );
      fixture.statements.length = 0;
      const citations = await loadVerifiedManifestCitations(fixture.execSql, {
        kind: "document",
        id: "doc",
      });
      expect(citations).toEqual(ids.slice(0, 48).map(level));
      const stats = readStats(fixture);
      console.info("citation-read-bounds", JSON.stringify({ count, ...stats }));
      expect(stats.maxBinds).toBeLessThanOrEqual(999);
      expect(stats.jsonRows).toBeLessThanOrEqual(48);
      if (count === 520) {
        await fixture.db
          .update(containers)
          .set({ organizationId: "foreign" })
          .where(eq(containers.id, ids.at(-1) ?? ""))
          .run();
        expect(
          await loadVerifiedManifestCitations(fixture.execSql, {
            kind: "document",
            id: "doc",
          }),
        ).toEqual([]);
      }
    } finally {
      fixture.close();
    }
  });

test("damaged batched rows replay each object's original remaining quota", async () => {
  const fixture = await citationDatabase();
  try {
    await fixture.container("root");
    await fixture.container("middle", "root");
    await fixture.container("child", "middle");
    await remember(fixture.execSql, [
      entry("child", 2, 1),
      entry("child", 1, 2),
      entry("middle", 2, 3),
      entry("middle", 1, 4),
      entry("root", 1, 5),
    ]);
    await fixture.db
      .update(bundles)
      .set({ bundleDigest: "damaged" })
      .where(eq(bundles.manifestHash, hash(1)))
      .run();
    await fixture.db
      .update(bundles)
      .set({ verifiedAt: "2027-01-01T00:00:00.000Z" })
      .where(eq(bundles.manifestHash, hash(5)))
      .run();
    expect(
      await loadVerifiedManifestCitations(
        fixture.execSql,
        { kind: "container", id: "child" },
        2,
      ),
    ).toEqual([entry("child", 1, 2).bundle, entry("middle", 2, 3).bundle]);
    expect(
      await fixture.db
        .select()
        .from(bundles)
        .where(eq(bundles.manifestHash, hash(1))),
    ).toEqual([]);
  } finally {
    fixture.close();
  }
});

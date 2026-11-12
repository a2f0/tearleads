import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  citationDatabase,
  entry,
  hash,
  remember,
} from "../../../../test/helpers/verifiedCitationReads";
import { verifiedAccessManifestBundles as bundles } from "../../sqlite/schema/verifiedManifestBundleSchema";
import { createExecSql } from "../../sqlite/sqlSchema";
import { loadVerifiedManifestCitations } from "../verifiedManifestBundlePersistence";

test("eviction between metadata and JSON reads replays the object loop", async () => {
  const fixture = await citationDatabase();
  try {
    await fixture.container("root");
    await fixture.container("middle", "root");
    await fixture.container("child", "middle");
    await remember(fixture.execSql, [
      entry("child", 2, 1),
      entry("child", 1, 2),
      entry("middle", 1, 3),
      entry("root", 1, 4),
    ]);
    await fixture.db
      .update(bundles)
      .set({ verifiedAt: "2027-01-01T00:00:00.000Z" })
      .where(eq(bundles.manifestHash, hash(4)))
      .run();
    let evicted = false;
    const racing = createExecSql({
      exec: async ({ sql, bind, rowMode }) => {
        if (
          !evicted &&
          sql.startsWith('select "bundle_digest"') &&
          sql.includes('"manifest_hash" in')
        ) {
          evicted = true;
          await fixture.db
            .delete(bundles)
            .where(eq(bundles.manifestHash, hash(1)))
            .run();
        }
        return {
          rows: await fixture.execSql(
            sql,
            bind,
            rowMode ? { rowMode } : undefined,
          ),
        };
      },
    });
    expect(
      await loadVerifiedManifestCitations(
        racing,
        { kind: "container", id: "child" },
        2,
      ),
    ).toEqual([entry("child", 1, 2).bundle, entry("middle", 1, 3).bundle]);
    expect(evicted).toBe(true);
    expect(
      await loadVerifiedManifestCitations(
        racing,
        { kind: "container", id: "child" },
        2,
      ),
    ).toEqual([entry("child", 1, 2).bundle, entry("middle", 1, 3).bundle]);
  } finally {
    fixture.close();
  }
});

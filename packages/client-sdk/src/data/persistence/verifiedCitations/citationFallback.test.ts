import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  citationDatabase,
  entry,
  level,
  NOW,
  ORGANIZATION,
  remember,
} from "../../../../test/helpers/verifiedCitationReads";
import { localIntentTables } from "../../sqlite/schema";
import { containers } from "../../sqlite/schema/containerSchema";
import {
  documentProjection,
  documentProjectionTables,
} from "../../sqlite/schema/documentProjectionSchema";
import {
  LOCAL_INTENT_LANES,
  localIntents,
} from "../../sqlite/schema/localIntentSchema";
import { verifiedAccessManifestBundles as bundles } from "../../sqlite/schema/verifiedManifestBundleSchema";
import { ensureSqlTables } from "../../sqlite/sqlSchema";
import { loadVerifiedManifestCitations } from "../verifiedManifestBundlePersistence";

test("an unplaced document uses its local organization for recent levels", async () => {
  const fixture = await citationDatabase();
  try {
    await ensureSqlTables(fixture.execSql, documentProjectionTables);
    await fixture.db
      .insert(documentProjection)
      .values({
        localId: "local",
        documentId: "doc",
        organizationId: ORGANIZATION,
        updatedAt: NOW,
      })
      .run();
    await remember(fixture.execSql, [
      { kekLevel: level("root"), organizationId: ORGANIZATION },
      { kekLevel: level("foreign"), organizationId: "foreign" },
    ]);
    expect(
      await loadVerifiedManifestCitations(fixture.execSql, {
        kind: "document",
        id: "doc",
      }),
    ).toEqual([level("root")]);
    expect(
      await loadVerifiedManifestCitations(fixture.execSql, {
        kind: "document",
        id: "unknown",
      }),
    ).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("local organization fallback neither rescues disagreement nor overrides a live parent", async () => {
  const fixture = await citationDatabase();
  try {
    await fixture.container("root");
    await fixture.db
      .insert(documentProjection)
      .values({
        localId: "local",
        documentId: "doc",
        containerId: "root",
        organizationId: "foreign",
        updatedAt: NOW,
      })
      .run();
    await remember(fixture.execSql, [
      { kekLevel: level("held"), organizationId: ORGANIZATION },
    ]);
    const cite = () =>
      loadVerifiedManifestCitations(fixture.execSql, {
        kind: "document",
        id: "doc",
      });
    expect(await cite()).toEqual([level("held")]);
    // A second local record with a different organization is ambiguous.
    await fixture.db
      .insert(documentProjection)
      .values({
        localId: "other",
        documentId: "doc",
        organizationId: "foreign",
        updatedAt: NOW,
      })
      .run();
    expect(await cite()).toEqual([]);
    // Conflicting verified ownership is never repaired by the local row.
    await remember(fixture.execSql, [
      entry("doc", 1, 501, "document"),
      entry("doc", 2, 502, "document", "foreign"),
    ]);
    expect(await cite()).toEqual([]);
    await fixture.db.delete(containers).where(eq(containers.id, "root")).run();
    expect(await cite()).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("missing lineage levels fall back by organization recency, not epoch", async () => {
  const fixture = await citationDatabase();
  try {
    await fixture.container("root");
    await remember(fixture.execSql, [
      { kekLevel: level("older"), organizationId: ORGANIZATION },
      { kekLevel: level("newer"), organizationId: ORGANIZATION },
    ]);
    await fixture.db
      .update(bundles)
      .set({ verifiedAt: "2027-01-01T00:00:00.000Z" })
      .where(eq(bundles.objectId, "newer"))
      .run();
    expect(
      await loadVerifiedManifestCitations(fixture.execSql, {
        kind: "container",
        id: "root",
      }),
    ).toEqual([level("newer"), level("older")]);
  } finally {
    fixture.close();
  }
});

for (const kind of ["container", "document"] as const)
  test(`${kind} pending move supplements lineage levels until acknowledged`, async () => {
    const fixture = await citationDatabase();
    try {
      await ensureSqlTables(fixture.execSql, localIntentTables);
      await fixture.container("root");
      await fixture.container(
        "moving",
        "root",
        ORGANIZATION,
        kind === "document" ? "doc" : null,
      );
      await remember(fixture.execSql, [
        { kekLevel: level("root"), organizationId: ORGANIZATION },
        { kekLevel: level("destination"), organizationId: ORGANIZATION },
        { kekLevel: level("foreign"), organizationId: "foreign" },
      ]);
      const target = { kind, id: kind === "document" ? "doc" : "moving" };
      expect(
        await loadVerifiedManifestCitations(fixture.execSql, target),
      ).toEqual([level("root")]);
      await fixture.db
        .insert(localIntents)
        .values({
          id: "intent",
          lane:
            kind === "container"
              ? LOCAL_INTENT_LANES.containerMove
              : LOCAL_INTENT_LANES.documentPlacement,
          intentType: `${kind}.move`,
          subjectId: target.id,
          targetContainerId: "destination",
          syncStatus: "pending",
          createdAt: NOW,
          updatedAt: NOW,
        })
        .run();
      expect(
        await loadVerifiedManifestCitations(fixture.execSql, target),
      ).toEqual([level("root"), level("destination")]);
      await fixture.db
        .delete(localIntents)
        .where(eq(localIntents.id, "intent"))
        .run();
      expect(
        await loadVerifiedManifestCitations(fixture.execSql, target),
      ).toEqual([level("root")]);
    } finally {
      fixture.close();
    }
  });

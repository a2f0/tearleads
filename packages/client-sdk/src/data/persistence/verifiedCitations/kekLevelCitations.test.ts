import { expect, test } from "bun:test";
import { computeContainerKekLevelDigest } from "@tearleads/crypto";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import type { ContainerKekWireLevel } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { containerTables } from "../../sqlite/schema";
import { containers } from "../../sqlite/schema/containerSchema";
import { verifiedAccessManifestBundles } from "../../sqlite/schema/verifiedManifestBundleSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { advanceKeyingCheckpointsAtomically } from "../keyingCheckpoints/keyingCheckpointAdvancePersistence";
import {
  loadVerifiedManifestCitations,
  type VerifiedManifestBundle,
} from "../verifiedManifestBundlePersistence";
import { KEK_LEVEL_OBJECT_KIND } from "./kekLevelCitations";

const ORGANIZATION = "organization-1";

function hash(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function bundleEntry(manifestHash: string, objectId: string, epoch: number) {
  return {
    bundle: {
      event: { body: { epoch }, event: { objectId }, eventHash: `e${epoch}` },
      manifest: { objectId, epoch },
      manifestHash,
      state: { epoch },
    },
    checkpoint: {
      objectKind: "container",
      organizationId: ORGANIZATION,
      objectId,
      epoch,
    },
  };
}

function level(
  containerId: string,
  epoch: number,
  wrap = "wrap-1",
): ContainerKekWireLevel {
  return {
    accessManifestHash: hash(100 + epoch),
    containerId,
    containerKeyEpoch: epoch,
    containerKeyEpochId: `${containerId}-epoch-${epoch}`,
    containerManifestHistory: [hash(100 + epoch)],
    keyEpoch: { containerId, epoch },
    keyEpochHash: hash(200 + epoch),
    keyring:
      epoch === 1
        ? null
        : {
            containerId,
            containerKeyEpochId: `${containerId}-epoch-${epoch}`,
            iv: "AAAAAAAAAAAAAAAA",
            sealed: "c2VhbGVk",
            sealingSuite: "test-suite",
            version: 1,
          },
    keyTargetHash: hash(300 + epoch),
    parentContainerKeyEpochId: null,
    recipientTargets: [{ principalId: "user-1" }],
    wraps: [{ recipient: "user-1", envelope: wrap }],
  };
}

function levelEntry(kekLevel: ContainerKekWireLevel): VerifiedManifestBundle {
  return { kekLevel, organizationId: ORGANIZATION };
}

function remember(
  execSql: ExecSql,
  verifiedBundles: readonly VerifiedManifestBundle[],
): Promise<void> {
  return advanceKeyingCheckpointsAtomically({
    access: [],
    execSql,
    policies: [],
    verifiedBundles,
  });
}

async function seedRoot(execSql: ExecSql) {
  await ensureSqlTables(execSql, containerTables);
  const now = new Date().toISOString();
  for (const [id, organizationId] of [
    ["root", ORGANIZATION],
    ["foreign-root", "organization-2"],
  ] as const)
    await getClientSQLitePersistenceRuntime(execSql)
      .db.insert(containers)
      .values({
        id,
        organizationId,
        parentId: null,
        localCreatedAt: now,
        localUpdatedAt: now,
      })
      .run();
}

function keys(citations: readonly object[]): unknown[] {
  return citations.map((citation) =>
    "manifestHash" in citation
      ? Reflect.get(citation, "manifestHash")
      : `k:${Reflect.get(citation, "containerId")}`,
  );
}

test("an unstored container cites its listed parent's lineage", async () => {
  const database = createNativeTestExecSql();
  try {
    await seedRoot(database.execSql);
    await remember(database.execSql, [bundleEntry(hash(1), "root", 1)]);
    const cite = (listing?: {
      organizationId: string;
      parentId: string | null;
    }) =>
      loadVerifiedManifestCitations(database.execSql, {
        kind: "container",
        id: "child",
        listing,
      });
    // Without its listing the child has no local row, so nothing places it.
    expect(await cite()).toEqual([]);
    expect(
      keys(await cite({ organizationId: ORGANIZATION, parentId: "root" })),
    ).toEqual([hash(1)]);
    // The listing's organization is one more source that must agree.
    expect(
      await cite({ organizationId: "organization-2", parentId: "root" }),
    ).toEqual([]);
  } finally {
    database.close();
  }
});

test("a stored container keeps its own lineage whatever its listing says", async () => {
  const database = createNativeTestExecSql();
  try {
    await seedRoot(database.execSql);
    await remember(database.execSql, [bundleEntry(hash(1), "root", 1)]);
    expect(
      keys(
        await loadVerifiedManifestCitations(database.execSql, {
          kind: "container",
          id: "root",
          // A listing naming another organization's container is ignored.
          listing: { organizationId: ORGANIZATION, parentId: "foreign-root" },
        }),
      ),
    ).toEqual([hash(1)]);
  } finally {
    database.close();
  }
});

test("verified KEK levels are cited first, keyed by their canonical digest", async () => {
  const database = createNativeTestExecSql();
  try {
    await seedRoot(database.execSql);
    const rootLevel = level("root", 2);
    await remember(database.execSql, [
      bundleEntry(hash(1), "root", 1),
      levelEntry(level("root", 1)),
      levelEntry(rootLevel),
    ]);
    const cited = await loadVerifiedManifestCitations(database.execSql, {
      kind: "container",
      id: "root",
    });
    // Only the newest level per container; then the container's bundles.
    expect(keys(cited)).toEqual(["k:root", hash(1)]);
    expect(cited[0]).toEqual(rootLevel);
    const { db } = getClientSQLitePersistenceRuntime(database.execSql);
    const rows = await db
      .select()
      .from(verifiedAccessManifestBundles)
      .where(
        eq(verifiedAccessManifestBundles.objectKind, KEK_LEVEL_OBJECT_KIND),
      );
    // Recording a container's level drops its superseded ones.
    expect(rows.map((row) => row.manifestHash)).toEqual([
      String(await computeContainerKekLevelDigest(rootLevel)),
    ]);
    expect(rows[0]?.epoch).toBe(2);
  } finally {
    database.close();
  }
});

test("a new wrap in the same epoch replaces the held level", async () => {
  const database = createNativeTestExecSql();
  try {
    await seedRoot(database.execSql);
    await remember(database.execSql, [levelEntry(level("root", 1))]);
    const rewrapped = level("root", 1, "wrap-2");
    await remember(database.execSql, [levelEntry(rewrapped)]);
    expect(
      await loadVerifiedManifestCitations(database.execSql, {
        kind: "container",
        id: "root",
      }),
    ).toEqual([rewrapped]);
  } finally {
    database.close();
  }
});

test("a damaged level row is dropped instead of cited", async () => {
  const database = createNativeTestExecSql();
  try {
    await seedRoot(database.execSql);
    await remember(database.execSql, [
      bundleEntry(hash(1), "root", 1),
      levelEntry(level("root", 1)),
    ]);
    const { db } = getClientSQLitePersistenceRuntime(database.execSql);
    // Valid level bytes stored under another level's digest.
    await db
      .update(verifiedAccessManifestBundles)
      .set({ bundleJson: JSON.stringify(level("root", 1, "forged")) })
      .where(
        eq(verifiedAccessManifestBundles.objectKind, KEK_LEVEL_OBJECT_KIND),
      )
      .run();
    expect(
      keys(
        await loadVerifiedManifestCitations(database.execSql, {
          kind: "container",
          id: "root",
        }),
      ),
    ).toEqual([hash(1)]);
    const remaining = await db
      .select({ objectKind: verifiedAccessManifestBundles.objectKind })
      .from(verifiedAccessManifestBundles);
    expect(remaining).toEqual([{ objectKind: "container" }]);
  } finally {
    database.close();
  }
});

import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { containers } from "../sqlite/containerSchema";
import {
  containerTables,
  documentContainerProjection,
  documentContainerProjectionTables,
} from "../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../sqlite/sqlSchema";
import { verifiedAccessManifestBundles } from "../sqlite/verifiedManifestBundleSchema";
import {
  createVerifiedManifestCitations,
  loadVerifiedManifestCitations,
  MAX_VERIFIED_MANIFEST_BUNDLES,
  rememberVerifiedManifestBundles,
} from "./verifiedManifestBundlePersistence";

const ORGANIZATION = "organization-1";

function hash(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function entry(
  manifestHash: string,
  objectKind: string,
  objectId: string,
  epoch: number,
) {
  return {
    bundle: {
      event: { body: { epoch }, event: { objectId }, eventHash: `e${epoch}` },
      manifest: { objectId, epoch },
      manifestHash,
      state: { epoch },
    },
    checkpoint: { objectKind, organizationId: ORGANIZATION, objectId, epoch },
  };
}

async function seedTree(execSql: Parameters<typeof ensureSqlTables>[0]) {
  await ensureSqlTables(execSql, [
    ...containerTables,
    ...documentContainerProjectionTables,
  ]);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const now = new Date().toISOString();
  for (const [id, parentId] of [
    ["root", null],
    ["child", "root"],
    ["other", null],
  ] as const)
    await db
      .insert(containers)
      .values({
        id,
        organizationId: ORGANIZATION,
        parentId,
        localCreatedAt: now,
        localUpdatedAt: now,
      })
      .run();
  await db
    .insert(documentContainerProjection)
    .values({ documentId: "doc", containerId: "child", updatedAt: now })
    .run();
}

test("a container cites its lineage, its ancestors', then recent rows", async () => {
  const database = createNativeTestExecSql();
  try {
    await seedTree(database.execSql);
    await rememberVerifiedManifestBundles(database.execSql, [
      entry(hash(1), "container", "root", 1),
      entry(hash(2), "container", "root", 2),
      entry(hash(3), "container", "child", 1),
      entry(hash(4), "container", "other", 1),
      entry(hash(5), "document", "doc", 1),
    ]);
    const cited = async (kind: "container" | "document", id: string) =>
      (await loadVerifiedManifestCitations(database.execSql, { kind, id })).map(
        (bundle) => bundle.manifestHash,
      );
    // Lineage first, newest epoch first; then the organization's most
    // recently verified rows.
    expect(await cited("container", "child")).toEqual([
      hash(3),
      hash(2),
      hash(1),
      hash(4),
      hash(5),
    ]);
    expect(await cited("document", "doc")).toEqual([
      hash(5),
      hash(3),
      hash(2),
      hash(1),
      hash(4),
    ]);
    expect(
      await loadVerifiedManifestCitations(
        database.execSql,
        { kind: "container", id: "child" },
        2,
      ),
    ).toHaveLength(2);
    // A target the device has not listed cites the most recent rows.
    expect(await cited("container", "unknown")).toEqual([
      hash(1),
      hash(2),
      hash(3),
      hash(4),
      hash(5),
    ]);
  } finally {
    database.close();
  }
});

test("a damaged row is dropped instead of cited", async () => {
  const database = createNativeTestExecSql();
  try {
    await seedTree(database.execSql);
    await rememberVerifiedManifestBundles(database.execSql, [
      entry(hash(1), "container", "root", 1),
      entry(hash(2), "container", "root", 2),
    ]);
    const { db } = getClientSQLitePersistenceRuntime(database.execSql);
    await db
      .update(verifiedAccessManifestBundles)
      .set({ bundleJson: JSON.stringify(entry(hash(9), "x", "y", 1).bundle) })
      .where(eq(verifiedAccessManifestBundles.manifestHash, hash(2)))
      .run();
    const cited = await loadVerifiedManifestCitations(database.execSql, {
      kind: "container",
      id: "root",
    });
    expect(cited.map((bundle) => bundle.manifestHash)).toEqual([hash(1)]);
    const remaining = await db
      .select({ manifestHash: verifiedAccessManifestBundles.manifestHash })
      .from(verifiedAccessManifestBundles);
    expect(remaining.map((row) => row.manifestHash)).toEqual([hash(1)]);
  } finally {
    database.close();
  }
});

test("the table keeps the most recently verified bundles", async () => {
  const database = createNativeTestExecSql();
  try {
    await rememberVerifiedManifestBundles(database.execSql, [
      entry(hash(0), "container", "root", 1),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await rememberVerifiedManifestBundles(
      database.execSql,
      Array.from({ length: MAX_VERIFIED_MANIFEST_BUNDLES }, (_, index) =>
        entry(hash(index + 1), "container", "root", index + 2),
      ),
    );
    const { db } = getClientSQLitePersistenceRuntime(database.execSql);
    const rows = await db
      .select({ manifestHash: verifiedAccessManifestBundles.manifestHash })
      .from(verifiedAccessManifestBundles);
    expect(rows).toHaveLength(MAX_VERIFIED_MANIFEST_BUNDLES);
    expect(rows.some((row) => row.manifestHash === hash(0))).toBe(false);
  } finally {
    database.close();
  }
});

test("re-verifying a stored bundle keeps it ahead of eviction", async () => {
  const database = createNativeTestExecSql();
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
  try {
    await rememberVerifiedManifestBundles(database.execSql, [
      entry(hash(0), "container", "root", 1),
      entry(hash(1), "container", "root", 2),
    ]);
    await tick();
    await rememberVerifiedManifestBundles(
      database.execSql,
      Array.from({ length: MAX_VERIFIED_MANIFEST_BUNDLES - 2 }, (_, index) =>
        entry(hash(index + 2), "container", "child", index + 1),
      ),
    );
    await tick();
    await rememberVerifiedManifestBundles(database.execSql, [
      entry(hash(0), "container", "root", 1),
    ]);
    await tick();
    await rememberVerifiedManifestBundles(database.execSql, [
      entry(hash(5000), "container", "other", 1),
    ]);
    const { db } = getClientSQLitePersistenceRuntime(database.execSql);
    const kept = new Set(
      (
        await db
          .select({ manifestHash: verifiedAccessManifestBundles.manifestHash })
          .from(verifiedAccessManifestBundles)
      ).map((row) => row.manifestHash),
    );
    expect(kept.has(hash(0))).toBe(true);
    expect(kept.has(hash(1))).toBe(false);
    expect(kept.has(hash(5000))).toBe(true);
  } finally {
    database.close();
  }
});

test("without a database the device cites nothing", async () => {
  expect(
    await createVerifiedManifestCitations(() => null).cite({
      kind: "container",
      id: "root",
    }),
  ).toEqual([]);
});

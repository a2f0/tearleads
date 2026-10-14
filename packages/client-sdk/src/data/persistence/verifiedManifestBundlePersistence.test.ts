import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { containers } from "../sqlite/containerSchema";
import {
  documentDiscoveryHeads,
  pendingDocumentDiscoveries,
} from "../sqlite/documentDiscoveryEvidenceSchema";
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
const FOREIGN = "organization-2";

function hash(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function entry(
  manifestHash: string,
  objectKind: string,
  objectId: string,
  epoch: number,
  organizationId = ORGANIZATION,
) {
  return {
    bundle: {
      event: { body: { epoch }, event: { objectId }, eventHash: `e${epoch}` },
      manifest: { objectId, epoch },
      manifestHash,
      state: { epoch },
    },
    checkpoint: { objectKind, organizationId, objectId, epoch },
  };
}

async function seedTree(execSql: Parameters<typeof ensureSqlTables>[0]) {
  await ensureSqlTables(execSql, [
    ...containerTables,
    ...documentContainerProjectionTables,
  ]);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const now = new Date().toISOString();
  for (const [id, parentId, organizationId, metadataDocumentId] of [
    ["root", null, ORGANIZATION, null],
    ["child", "root", ORGANIZATION, "child-metadata"],
    ["other", null, ORGANIZATION, null],
    ["foreign", null, FOREIGN, null],
  ] as const)
    await db
      .insert(containers)
      .values({
        id,
        organizationId,
        parentId,
        metadataDocumentId,
        localCreatedAt: now,
        localUpdatedAt: now,
      })
      .run();
  await db
    .insert(pendingDocumentDiscoveries)
    .values({
      containerId: "child",
      documentId: "listed-doc",
      accessEpoch: 1,
      generation: 1,
      inputJson: "{}",
    })
    .run();
  await db
    .insert(documentContainerProjection)
    .values({ documentId: "doc", containerId: "child", updatedAt: now })
    .run();
}

test("a read cites its lineage, its ancestors', then its organization's recent rows", async () => {
  const database = createNativeTestExecSql();
  try {
    await seedTree(database.execSql);
    await rememberVerifiedManifestBundles(database.execSql, [
      entry(hash(1), "container", "root", 1),
      entry(hash(2), "container", "root", 2),
      entry(hash(3), "container", "child", 1),
      entry(hash(4), "container", "other", 1),
      entry(hash(5), "document", "doc", 1),
      entry(hash(6), "container", "foreign", 1, FOREIGN),
      entry(hash(7), "document", "unlisted-doc", 1),
    ]);
    const cited = async (kind: "container" | "document", id: string) =>
      (await loadVerifiedManifestCitations(database.execSql, { kind, id })).map(
        (bundle) => bundle.manifestHash,
      );
    // Lineage first, newest epoch first; then the organization's most
    // recently verified rows. Another organization's rows never appear.
    expect(await cited("container", "child")).toEqual([
      hash(3),
      hash(2),
      hash(1),
      hash(4),
      hash(5),
      hash(7),
    ]);
    expect(await cited("document", "doc")).toEqual([
      hash(5),
      hash(3),
      hash(2),
      hash(1),
      hash(4),
      hash(7),
    ]);
    expect(await cited("container", "foreign")).toEqual([hash(6)]);
    expect(
      await loadVerifiedManifestCitations(
        database.execSql,
        { kind: "container", id: "child" },
        2,
      ),
    ).toHaveLength(2);
    // An unlisted object placed by its own verified rows stays in its
    // organization; one the device cannot place cites nothing.
    expect(await cited("document", "unlisted-doc")).toEqual([
      hash(7),
      hash(1),
      hash(2),
      hash(3),
      hash(4),
      hash(5),
    ]);
    expect(await cited("container", "unknown")).toEqual([]);
    // A document still awaiting signed placement, or a container's metadata
    // document, cites the containers that name it.
    for (const id of ["listed-doc", "child-metadata"])
      expect((await cited("document", id)).slice(0, 3)).toEqual([
        hash(3),
        hash(2),
        hash(1),
      ]);
  } finally {
    database.close();
  }
});

test("a discovered document cites within its discovery head's organization", async () => {
  const database = createNativeTestExecSql();
  try {
    await seedTree(database.execSql);
    await rememberVerifiedManifestBundles(database.execSql, [
      entry(hash(1), "container", "root", 1),
      entry(hash(6), "container", "foreign", 1, FOREIGN),
    ]);
    const { db } = getClientSQLitePersistenceRuntime(database.execSql);
    await db
      .insert(documentDiscoveryHeads)
      .values({
        documentId: "discovered",
        organizationId: FOREIGN,
        manifestHash: hash(8),
        accessEpoch: 1,
        linksJson: "[]",
      })
      .run();
    expect(
      (
        await loadVerifiedManifestCitations(database.execSql, {
          kind: "document",
          id: "discovered",
        })
      ).map((bundle) => bundle.manifestHash),
    ).toEqual([hash(6)]);
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

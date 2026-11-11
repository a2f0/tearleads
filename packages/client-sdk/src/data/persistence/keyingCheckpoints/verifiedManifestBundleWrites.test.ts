import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import { verifiedManifestBundleTables } from "../../sqlite/schema/verifiedManifestBundleSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../sqlite/sqlSchema";
import { writeVerifiedManifestBundlesInTransaction as write } from "../verifiedManifestBundlePersistence";

const row = (index: number) => ({
  manifestHash: `hash-${index}`,
  bundleDigest: `digest-${index}`,
  bundleJson: `{"index":${index}}`,
  epoch: 1,
  objectId: `container-${index}`,
  objectKind: "container-kek-level",
  organizationId: "organization",
});
const before = "2026-01-01T00:00:00.000Z";
const after = "2026-01-02T00:00:00.000Z";

test("unchanged levels only touch recency, including across statement batches", async () => {
  const db = createNativeTestExecSql();
  const counted = countingExecSql(db.execSql);
  const runtime = getClientSQLitePersistenceRuntime(counted.execSql);
  const rows = Array.from({ length: 201 }, (_, index) => row(index));
  try {
    await ensureSqlTables(counted.execSql, verifiedManifestBundleTables);
    await runtime.transaction((tx) => write(tx, rows, before));
    expect(
      await counted.count(() =>
        runtime.transaction((tx) => write(tx, rows, after)),
      ),
    ).toBe(4);
    const stored = await db.execSql(
      "SELECT * FROM verified_access_manifest_bundles",
    );
    expect(stored).toHaveLength(201);
    expect(
      stored.every((entry) => Reflect.get(entry, "verified_at") === after),
    ).toBe(true);
  } finally {
    db.close();
  }
});

test("changed bundles replace bytes, supersede levels and roll back recency atomically", async () => {
  const db = createNativeTestExecSql();
  const runtime = getClientSQLitePersistenceRuntime(db.execSql);
  const changed = { ...row(0), bundleDigest: "changed", bundleJson: "changed" };
  const newer = { ...row(1), manifestHash: "newer", epoch: 2 };
  try {
    await ensureSqlTables(db.execSql, verifiedManifestBundleTables);
    await runtime.transaction((tx) =>
      write(tx, [row(0), row(1), row(2)], before),
    );
    await expect(
      runtime.transaction(async (tx) => {
        await write(tx, [changed, newer, row(2)], after);
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(
      (
        await db.execSql(
          "SELECT verified_at FROM verified_access_manifest_bundles",
        )
      ).every((entry) => Reflect.get(entry, "verified_at") === before),
    ).toBe(true);
    await runtime.transaction((tx) =>
      write(tx, [changed, newer, row(2)], after),
    );
    expect(
      await db.execSql(
        "SELECT manifest_hash, bundle_json, verified_at FROM verified_access_manifest_bundles ORDER BY object_id",
      ),
    ).toEqual([
      { manifest_hash: "hash-0", bundle_json: "changed", verified_at: after },
      {
        manifest_hash: "newer",
        bundle_json: row(1).bundleJson,
        verified_at: after,
      },
      {
        manifest_hash: "hash-2",
        bundle_json: row(2).bundleJson,
        verified_at: after,
      },
    ]);
  } finally {
    db.close();
  }
});

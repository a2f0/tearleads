import { expect, test } from "bun:test";
import type {
  AnyVerifiedAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { asc } from "drizzle-orm";
import {
  accessManifestCheckpoints,
  keyingCheckpointTables,
  principalPolicyCheckpoints,
  principalPolicyOrganizations,
  principalPolicyTables,
} from "../../sqlite/schema";
import { principalGrantRetirements } from "../../sqlite/schema/principalGrantRetirementSchema";
import {
  verifiedAccessManifestBundles,
  verifiedManifestBundleTables,
} from "../../sqlite/schema/verifiedManifestBundleSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { createExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import type { VerifiedManifestBundle } from "../verifiedManifestBundlePersistence";
import { advanceKeyingCheckpointsAtomically } from "./keyingCheckpointAdvancePersistence";

function hash(seed: string): string {
  return Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64);
}

function manifest(objectId: string, epoch = 1): AnyVerifiedAccessManifest {
  const manifestHash = hash(`${objectId}-${epoch}`);
  return {
    checkpoint: {
      epoch,
      manifestHash,
      objectId,
      objectKind: "container",
      organizationId: "org-1",
    },
    manifest: { previousManifestHash: null },
    manifestHash,
  } as unknown as AnyVerifiedAccessManifest;
}

function policy(principalId: string): VerifiedPrincipalPolicy {
  const stateHash = hash(`${principalId}-state`);
  const state = { principalId, principalType: "group", stateHash, version: 1 };
  return {
    checkpoint: { principalId, principalType: "group", stateHash, version: 1 },
    history: [{ state }],
    principalId,
    principalType: "group",
    state,
    stateHash,
    version: 1,
  } as unknown as VerifiedPrincipalPolicy;
}

function bundle(objectId: string): VerifiedManifestBundle {
  const head = manifest(objectId);
  return {
    bundle: {
      manifestHash: head.manifestHash,
    } as unknown as AccessManifestBundleWireResponse,
    checkpoint: head.checkpoint,
  };
}

async function checkpointDatabase() {
  const sqlite = await createTestExecSql("keying-checkpoint-advance-batch");
  const counter = { statements: 0 };
  const execSql = createExecSql({
    async exec({ sql, bind, rowMode }) {
      counter.statements += 1;
      return {
        rows: await sqlite.execSql(
          sql,
          bind,
          rowMode ? { rowMode } : undefined,
        ),
      };
    },
  });
  await ensureSqlTables(sqlite.execSql, [
    ...principalPolicyTables,
    ...keyingCheckpointTables,
    ...verifiedManifestBundleTables,
  ]);
  const { db } = getClientSQLitePersistenceRuntime(sqlite.execSql);
  return {
    ...sqlite,
    db,
    async advance(input: {
      readonly access: readonly AnyVerifiedAccessManifest[];
      readonly policies: readonly VerifiedPrincipalPolicy[];
      readonly bundles?: readonly VerifiedManifestBundle[];
    }) {
      await advanceKeyingCheckpointsAtomically({
        organizationId: "org-1",
        access: input.access.map((head) => ({ head, predecessors: [] })),
        execSql,
        policies: input.policies,
        verifiedBundles: input.bundles,
      });
      // Every table is ensured by the first advance; count a warm one.
      counter.statements = 0;
      await advanceKeyingCheckpointsAtomically({
        organizationId: "org-1",
        access: input.access.map((head) => ({ head, predecessors: [] })),
        execSql,
        policies: input.policies,
        verifiedBundles: input.bundles,
      });
      return counter.statements;
    },
    async snapshot() {
      return {
        access: await db
          .select()
          .from(accessManifestCheckpoints)
          .orderBy(asc(accessManifestCheckpoints.objectId)),
        policies: await db
          .select()
          .from(principalPolicyCheckpoints)
          .orderBy(asc(principalPolicyCheckpoints.principalId)),
        owners: await db
          .select()
          .from(principalPolicyOrganizations)
          .orderBy(asc(principalPolicyOrganizations.principalId)),
        bundles: await db
          .select({
            manifestHash: verifiedAccessManifestBundles.manifestHash,
            objectId: verifiedAccessManifestBundles.objectId,
            epoch: verifiedAccessManifestBundles.epoch,
          })
          .from(verifiedAccessManifestBundles)
          .orderBy(asc(verifiedAccessManifestBundles.objectId)),
      };
    },
  };
}

const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

test("a checkpoint advance takes a constant number of statements at any batch size", async () => {
  const counts: number[] = [];
  for (const [accessCount, policyCount, bundleCount] of [
    [1, 1, 1],
    [4, 2, 4],
    [16, 4, 16],
  ] as const) {
    const database = await checkpointDatabase();
    try {
      const access = ids("container", accessCount).map((id) => manifest(id));
      const policies = ids("group", policyCount).map(policy);
      const bundles = ids("container", bundleCount).map(bundle);
      counts.push(await database.advance({ access, policies, bundles }));
      const stored = await database.snapshot();
      expect(
        stored.access.map(({ objectId, epoch, manifestHash }) => ({
          objectId,
          epoch,
          manifestHash,
        })),
      ).toEqual(
        access
          .map(({ checkpoint }) => ({
            objectId: checkpoint.objectId,
            epoch: checkpoint.epoch,
            manifestHash: checkpoint.manifestHash,
          }))
          .sort((a, b) => a.objectId.localeCompare(b.objectId)),
      );
      expect(stored.policies.map(({ principalId }) => principalId)).toEqual(
        ids("group", policyCount).sort(),
      );
      expect(stored.owners.map(({ organizationId }) => organizationId)).toEqual(
        ids("group", policyCount).map(() => "org-1"),
      );
      expect(stored.bundles).toHaveLength(bundleCount);
    } finally {
      database.close();
    }
  }
  // A warm repeat: BEGIN, the retirement, access and policy reads, the access
  // upsert, the owner read (owners exist, so no insert), the policy upsert,
  // the bundle digests, their recency refresh, the prune count and COMMIT.
  // The per-row statements took 12, 25 and 69.
  expect(counts).toEqual([11, 11, 11]);
});

test("set reads keep the per-row validation order", async () => {
  const database = await checkpointDatabase();
  try {
    await database.db
      .insert(principalGrantRetirements)
      .values({
        organizationId: "org-1",
        containerId: "retired",
        principalId: "group-0",
        policyStateHash: hash("retired"),
      })
      .run();
    const fresh = manifest("fresh");
    const retired = manifest("retired");
    await expect(
      database.advance({ access: [fresh, retired, fresh], policies: [] }),
    ).rejects.toThrow(
      "Container retired was retired during principal rotation",
    );
    await expect(
      database.advance({ access: [fresh, fresh, retired], policies: [] }),
    ).rejects.toThrow("projection declares multiple access checkpoint heads");
    await database.db
      .insert(principalPolicyOrganizations)
      .values({
        principalType: "group",
        principalId: "group-1",
        organizationId: "org-2",
      })
      .run();
    await expect(
      database.advance({
        access: [fresh],
        policies: [policy("group-0"), policy("group-1"), policy("group-2")],
      }),
    ).rejects.toThrow(
      "principal policy cache is already owned by another organization",
    );
    const stored = await database.snapshot();
    expect(stored.access).toEqual([]);
    expect(stored.policies).toEqual([]);
    expect(stored.owners.map(({ principalId }) => principalId)).toEqual([
      "group-1",
    ]);
  } finally {
    database.close();
  }
});

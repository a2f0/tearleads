import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { organizationReadModelGroups } from "../../data/sqlite/organizationReadModelSchema";
import {
  clientSqlTables,
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
  principalPolicyCheckpoints,
  principalPolicyOrganizations,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

const STALE = "2026-08-01T00:00:00.000Z";

test.each([
  "current",
  "history",
  "references",
  "checkpoint",
] as const)("unowned %s group evidence refuses scoped purge without deleting or backfilling", async (placement) => {
  const { close, execSql } = await createTestExecSql(
    `sync-remote-reset-unowned-${placement}`,
  );
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const owned = policyRow("owned-group", "owned-head");
    const owner = {
      principalId: "owned-group",
      principalType: "group" as const,
      organizationId: "org-purged",
    };
    await db.insert(principalPolicies).values(owned);
    await db.insert(principalPolicyOrganizations).values(owner);
    // Display rows are not ownership evidence, even when they look usable.
    await db
      .insert(organizationReadModelGroups)
      .values(groupRow("org-purged", "unowned-group"));
    if (placement === "current" || placement === "history") {
      await db
        .insert(
          placement === "current"
            ? principalPolicies
            : principalPolicyBundleHistory,
        )
        .values(policyRow("unowned-group", "unowned-head"));
    } else if (placement === "references") {
      await db.insert(principalPolicyBundleReferences).values({
        principalType: "group",
        principalId: "unowned-group",
        version: 1,
        stateHash: "unowned-head",
        keyEpoch: 1,
        keyFingerprint: "key",
        bundleVersion: 1,
        bundleStateHash: "unowned-head",
      });
    } else {
      await db.insert(principalPolicyCheckpoints).values({
        principalType: "group",
        principalId: "unowned-group",
        version: 1,
        stateHash: "unowned-head",
        updatedAt: STALE,
      });
    }
    const tables = [
      principalPolicies,
      principalPolicyBundleHistory,
      principalPolicyBundleReferences,
      principalPolicyCheckpoints,
      principalPolicyOrganizations,
      organizationReadModelGroups,
    ] as const;
    const before = await Promise.all(
      tables.map((table) => db.select().from(table)),
    );
    await expect(
      clearRemoteSyncState(execSql, { organizationId: "org-purged" }),
    ).rejects.toThrow(
      "Unowned group policy cache requires a local database reset",
    );
    expect(
      await Promise.all(tables.map((table) => db.select().from(table))),
    ).toEqual(before);
    expect(await db.select().from(principalPolicyOrganizations)).toEqual([
      owner,
    ]);
  } finally {
    close();
  }
});

function policyRow(principalId: string, stateHash: string) {
  return {
    principalType: "group" as const,
    principalId,
    stateHash,
    currentStateJson: "{}",
    currentPayloadJson: "{}",
    currentProjectionJson: "[]",
    currentGrantsJson: "[]",
    currentMemberEnvelopesJson: "[]",
    previousStatesJson: "[]",
    updatedAt: STALE,
  };
}

function groupRow(organizationId: string, groupId: string) {
  return {
    createdAt: STALE,
    groupId,
    isBuiltin: false,
    keyEpoch: 1,
    memberCount: 1,
    name: groupId,
    organizationId,
    sortOrder: 0,
    stateHash: `${groupId}-head`,
    stateVersion: 1,
  };
}

test("reset follows pinned cache ownership without deriving it from read models", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-policy-ownership",
  );
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    await db
      .insert(principalPolicies)
      .values([
        policyRow("purged-group", "head"),
        policyRow("retained-group", "retained-head"),
      ]);
    await db
      .insert(principalPolicyBundleHistory)
      .values([
        policyRow("purged-group", "history"),
        policyRow("retained-group", "retained-history"),
      ]);
    await db.insert(principalPolicyBundleReferences).values([
      {
        principalType: "group",
        principalId: "purged-group",
        version: 1,
        stateHash: "history",
        keyEpoch: 1,
        keyFingerprint: "key",
        bundleVersion: 2,
        bundleStateHash: "head",
      },
      {
        principalType: "group",
        principalId: "retained-group",
        version: 1,
        stateHash: "retained-history",
        keyEpoch: 1,
        keyFingerprint: "retained-key",
        bundleVersion: 2,
        bundleStateHash: "retained-head",
      },
    ]);
    await db.insert(principalPolicyCheckpoints).values([
      {
        principalType: "group",
        principalId: "purged-group",
        version: 2,
        stateHash: "head",
        updatedAt: STALE,
      },
      {
        principalType: "group",
        principalId: "retained-group",
        version: 2,
        stateHash: "retained-head",
        updatedAt: STALE,
      },
    ]);
    await db.insert(principalPolicyOrganizations).values([
      {
        principalId: "purged-group",
        principalType: "group",
        organizationId: "org-purged",
      },
      {
        principalId: "retained-group",
        principalType: "group",
        organizationId: "org-retained",
      },
    ]);
    await db.insert(organizationReadModelGroups).values([
      groupRow("org-purged", "purged-group"),
      // A stale display row must not override atomically pinned ownership.
      groupRow("org-purged", "retained-group"),
    ]);

    const result = await clearRemoteSyncState(execSql, {
      organizationId: "org-purged",
    });

    expect(result.clearedPrincipalPolicyCount).toBe(1);
    for (const table of [
      principalPolicies,
      principalPolicyBundleHistory,
      principalPolicyBundleReferences,
      principalPolicyCheckpoints,
      principalPolicyOrganizations,
    ] as const) {
      expect(await db.select().from(table)).toEqual([
        expect.objectContaining({
          principalId: "retained-group",
          principalType: "group",
        }),
      ]);
    }
  } finally {
    close();
  }
});

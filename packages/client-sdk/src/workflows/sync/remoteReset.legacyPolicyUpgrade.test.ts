import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
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

test("an upgraded reset purges legacy policy caches without ownership rows", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-legacy-policy-upgrade",
  );
  try {
    await ensureSqlTables(
      execSql,
      clientSqlTables.filter(
        (table) => table.name !== "principal_policy_organizations",
      ),
    );
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    await db
      .insert(principalPolicies)
      .values([
        policyRow("legacy-unowned-group", "legacy-head"),
        policyRow("owned-retained-group", "retained-head"),
      ]);
    await db
      .insert(principalPolicyBundleHistory)
      .values([
        policyRow("legacy-unowned-group", "legacy-history"),
        policyRow("owned-retained-group", "retained-history"),
      ]);
    await db.insert(principalPolicyBundleReferences).values([
      {
        principalType: "group",
        principalId: "legacy-unowned-group",
        version: 1,
        stateHash: "legacy-history",
        keyEpoch: 1,
        keyFingerprint: "legacy-key",
        bundleVersion: 2,
        bundleStateHash: "legacy-head",
      },
      {
        principalType: "group",
        principalId: "owned-retained-group",
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
        principalId: "legacy-unowned-group",
        version: 2,
        stateHash: "legacy-head",
        updatedAt: STALE,
      },
      {
        principalType: "group",
        principalId: "owned-retained-group",
        version: 2,
        stateHash: "retained-head",
        updatedAt: STALE,
      },
    ]);
    await ensureSqlTables(execSql, clientSqlTables);
    await db.insert(principalPolicyOrganizations).values({
      principalType: "group",
      principalId: "owned-retained-group",
      organizationId: "org-retained",
    });

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
          principalId: "owned-retained-group",
          principalType: "group",
        }),
      ]);
    }
  } finally {
    close();
  }
});

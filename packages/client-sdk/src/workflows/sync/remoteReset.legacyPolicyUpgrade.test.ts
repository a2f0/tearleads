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

test("an upgraded reset derives ownership and retains another org's legacy cache", async () => {
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
        policyRow("legacy-purged-group", "legacy-head"),
        policyRow("legacy-retained-group", "retained-head"),
      ]);
    await db
      .insert(principalPolicyBundleHistory)
      .values([
        policyRow("legacy-purged-group", "legacy-history"),
        policyRow("legacy-retained-group", "retained-history"),
      ]);
    await db.insert(principalPolicyBundleReferences).values([
      {
        principalType: "group",
        principalId: "legacy-purged-group",
        version: 1,
        stateHash: "legacy-history",
        keyEpoch: 1,
        keyFingerprint: "legacy-key",
        bundleVersion: 2,
        bundleStateHash: "legacy-head",
      },
      {
        principalType: "group",
        principalId: "legacy-retained-group",
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
        principalId: "legacy-purged-group",
        version: 2,
        stateHash: "legacy-head",
        updatedAt: STALE,
      },
      {
        principalType: "group",
        principalId: "legacy-retained-group",
        version: 2,
        stateHash: "retained-head",
        updatedAt: STALE,
      },
    ]);
    await db
      .insert(organizationReadModelGroups)
      .values([
        groupRow("org-purged", "legacy-purged-group"),
        groupRow("org-retained", "legacy-retained-group"),
      ]);
    await ensureSqlTables(execSql, clientSqlTables);

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
          principalId: "legacy-retained-group",
          principalType: "group",
        }),
      ]);
    }
  } finally {
    close();
  }
});

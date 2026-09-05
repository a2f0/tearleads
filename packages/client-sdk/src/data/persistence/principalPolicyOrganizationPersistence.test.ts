import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPrincipalPolicyBundle } from "../../../test/helpers/policyCacheFixtures";
import {
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyCheckpoints,
  principalPolicyOrganizations,
} from "../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { upsertPrincipalPolicyCheckpointInTransaction } from "./keyingCheckpointPersistence";
import {
  retainPrincipalPolicyBundleInTransaction,
  savePrincipalPolicyBundle,
} from "./principalPolicyPersistence";

test.each([
  undefined,
  "",
])("group policy writes refuse missing ownership atomically (%s)", async (organizationId) => {
  const { close, execSql } = await createTestExecSql("policy-owner-required");
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const updatedAt = "2026-09-04T00:00:00.000Z";
    await expect(
      savePrincipalPolicyBundle(execSql, bundle, updatedAt, organizationId),
    ).rejects.toThrow("require an organization ID");
    const runtime = getClientSQLitePersistenceRuntime(execSql);
    await expect(
      runtime.transaction((tx) =>
        retainPrincipalPolicyBundleInTransaction(
          tx,
          bundle,
          updatedAt,
          organizationId,
        ),
      ),
    ).rejects.toThrow("require an organization ID");
    await expect(
      runtime.transaction((tx) =>
        upsertPrincipalPolicyCheckpointInTransaction(
          tx,
          {
            principalId: bundle.currentState.principalId,
            principalType: "group",
            stateHash: bundle.currentState.stateHash,
            version: bundle.currentState.version,
          },
          updatedAt,
          organizationId,
        ),
      ),
    ).rejects.toThrow("require an organization ID");
    expect(await runtime.db.select().from(principalPolicies)).toEqual([]);
    expect(
      await runtime.db.select().from(principalPolicyBundleHistory),
    ).toEqual([]);
    expect(await runtime.db.select().from(principalPolicyCheckpoints)).toEqual(
      [],
    );
    expect(
      await runtime.db.select().from(principalPolicyOrganizations),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("policy cache writes pin organization ownership and reject rebinding", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-organization-ownership",
  );
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(
      execSql,
      bundle,
      "2026-08-29T00:00:00.000Z",
      "org-one",
    );
    expect(
      await getClientSQLitePersistenceRuntime(execSql)
        .db.select()
        .from(principalPolicyOrganizations),
    ).toEqual([
      {
        organizationId: "org-one",
        principalId: bundle.currentState.principalId,
        principalType: "group",
      },
    ]);

    await expect(
      savePrincipalPolicyBundle(
        execSql,
        bundle,
        "2026-08-29T00:01:00.000Z",
        "org-two",
      ),
    ).rejects.toMatchObject({ code: "object_mismatch" });
  } finally {
    close();
  }
});

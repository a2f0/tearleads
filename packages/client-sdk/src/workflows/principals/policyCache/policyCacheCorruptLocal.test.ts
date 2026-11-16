import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  cacheReferencedPolicies,
  createPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
} from "../../../../test/helpers/policyCacheFixtures";
import { PrincipalPolicyBundleRepository } from "../../../data/persistence/principalPolicy/principalPolicyBundleRepository";

test("principal policy sync hard-fails without fetching or repairing an invalid exact match", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-corrupt-local-test",
  );

  try {
    const { bundle, getUserIdentity } = await createPrincipalPolicyBundle();
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).ensurePrincipalPolicyTables();
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).savePrincipalPolicyBundle(bundle, "org-1");
    await execSql(
      `UPDATE principal_policy_bundles
       SET current_state_json = ?
       WHERE is_current = 1 AND principal_type = ? AND principal_id = ?`,
      ["{}", "group", bundle.currentState.principalId],
    );

    let policyReadCount = 0;
    await expect(
      cacheReferencedPolicies({
        organizationId: "org-1",
        execSql,
        getCurrentPrincipalPolicy: async () => {
          policyReadCount += 1;
          return bundle;
        },
        getUserIdentity,
        references: [referencedPrincipalStateFromBundle(bundle)],
      }),
    ).rejects.toMatchObject({
      code: "invalid_shape",
      name: "KeyingVerificationError",
    });

    expect(policyReadCount).toBe(0);
    const rows = await execSql(
      `SELECT current_state_json AS currentStateJson
       FROM principal_policy_bundles
       WHERE is_current = 1 AND principal_type = ? AND principal_id = ?`,
      [bundle.currentState.principalType, bundle.currentState.principalId],
    );
    expect(Reflect.get(rows[0] ?? {}, "currentStateJson")).toBe("{}");
  } finally {
    close();
  }
});

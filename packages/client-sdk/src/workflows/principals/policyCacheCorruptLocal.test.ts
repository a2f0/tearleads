import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  cacheReferencedPolicies,
  createPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
} from "../../../test/helpers/policyCacheFixtures";
import {
  ensurePrincipalPolicyTables,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";

test("principal policy sync hard-fails without fetching or repairing an invalid exact match", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-corrupt-local-test",
  );

  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      bundle,
      "2026-07-17T00:00:00.000Z",
    );
    await execSql(
      `UPDATE principal_policies
       SET current_state_json = ?
       WHERE principal_type = ? AND principal_id = ?`,
      ["{}", "group", bundle.currentState.principalId],
    );

    let policyReadCount = 0;
    await expect(
      cacheReferencedPolicies({
        execSql,
        getCurrentPrincipalPolicy: async () => {
          policyReadCount += 1;
          return bundle;
        },
        getUserIdentity: async () => signerKeyResponse,
        references: [referencedPrincipalStateFromBundle(bundle)],
      }),
    ).rejects.toMatchObject({
      code: "invalid_shape",
      name: "KeyingVerificationError",
    });

    expect(policyReadCount).toBe(0);
    const rows = await execSql(
      `SELECT current_state_json AS currentStateJson
       FROM principal_policies
       WHERE principal_type = ? AND principal_id = ?`,
      [bundle.currentState.principalType, bundle.currentState.principalId],
    );
    expect(Reflect.get(rows[0] ?? {}, "currentStateJson")).toBe("{}");
  } finally {
    close();
  }
});

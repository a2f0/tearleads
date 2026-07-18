import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  cacheReferencedPolicies,
  createPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
} from "../../../test/helpers/policyCacheFixtures";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";

test("principal policy sync replaces an invalid local bundle with verified canonical data", async () => {
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

    const logs: string[] = [];
    let policyReadCount = 0;
    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => {
        policyReadCount += 1;
        return bundle;
      },
      getUserIdentity: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(policyReadCount).toBe(1);
    expect(
      logs.some((message) => message.includes("ignored invalid local")),
    ).toBe(true);
    await expect(
      loadPrincipalPolicyBundle(
        execSql,
        bundle.currentState.principalType,
        bundle.currentState.principalId,
      ),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

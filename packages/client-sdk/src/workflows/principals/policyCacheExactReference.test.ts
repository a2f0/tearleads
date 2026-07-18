import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  cacheReferencedPolicies,
  createPrincipalPolicyBundle,
  createSuccessorPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
} from "../../../test/helpers/policyCacheFixtures";
import { savePrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";

test("referenced policy warming re-verifies an exact local bundle without a policy GET", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-warmer-exact-local",
  );
  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");
    let policyGetCount = 0;

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => {
        policyGetCount += 1;
        return bundle;
      },
      getUserIdentity: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(policyGetCount).toBe(0);
  } finally {
    close();
  }
});

test("referenced policy warming performs one policy GET for a local head mismatch", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-warmer-head-mismatch",
  );
  try {
    const { bundle: cachedBundle } = await createPrincipalPolicyBundle();
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(
      execSql,
      cachedBundle,
      "2026-07-18T00:00:00Z",
    );
    let policyGetCount = 0;

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => {
        policyGetCount += 1;
        return bundle;
      },
      getUserIdentity: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(policyGetCount).toBe(1);
  } finally {
    close();
  }
});

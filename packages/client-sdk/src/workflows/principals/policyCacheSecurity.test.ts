import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  cacheReferencedPolicies,
  createPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
} from "../../../test/helpers/policyCacheFixtures";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";

test("principal policy cache preserves trusted identity integrity failures", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-identity-failure",
  );

  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const integrityError = new KeyingVerificationError(
      "equivocation",
      "signer identity changed",
    );

    await expect(
      cacheReferencedPolicies({
        execSql,
        getCurrentPrincipalPolicy: async () => bundle,
        getUserIdentity: async () => {
          throw integrityError;
        },
        references: [referencedPrincipalStateFromBundle(bundle)],
      }),
    ).rejects.toBe(integrityError);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

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

test("principal policy cache preserves foreign-instance integrity failures", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-foreign-instance-identity-failure",
  );

  try {
    const { bundle } = await createPrincipalPolicyBundle();
    // A KeyingVerificationError raised by a duplicate module instance of
    // @tearleads/crypto (e.g. a dist build loaded beside the source build)
    // fails the `instanceof KeyingVerificationError` check while still being
    // an `Error` with the class's name — the exact shape
    // isKeyingVerificationError's name clause exists for. It must abort the
    // cache pass instead of degrading to a logged skip. (An error from a
    // different JS realm is out of scope: it fails `instanceof Error` too and
    // is deliberately not matched.)
    const foreignInstanceError = new Error("signer identity changed");
    foreignInstanceError.name = "KeyingVerificationError";

    await expect(
      cacheReferencedPolicies({
        execSql,
        getCurrentPrincipalPolicy: async () => bundle,
        getUserIdentity: async () => {
          throw foreignInstanceError;
        },
        references: [referencedPrincipalStateFromBundle(bundle)],
      }),
    ).rejects.toBe(foreignInstanceError);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

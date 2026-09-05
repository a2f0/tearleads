import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  cacheReferencedPolicies,
  createPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
} from "../../../test/helpers/policyCacheFixtures";
import { trustedUserIdentityFromResponse } from "../../../test/helpers/trustedUserIdentity";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import { cachePrincipalPolicyBundles } from "./policyCache";

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
        organizationId: "org-1",
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

test("principal policy cache reports integrity failures that expire the generation", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-expired-identity-failure",
  );

  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const integrityError = new KeyingVerificationError(
      "equivocation",
      "signer identity changed while the generation expired",
    );
    const incidents: unknown[] = [];
    let current = true;

    await expect(
      cacheReferencedPolicies({
        execSql,
        organizationId: "org-1",
        getCurrentPrincipalPolicy: async () => bundle,
        getUserIdentity: async () => {
          current = false;
          throw integrityError;
        },
        references: [referencedPrincipalStateFromBundle(bundle)],
        reportSecurityIncident: async (error) => {
          incidents.push(error);
        },
        stillCurrent: () => current,
      }),
    ).rejects.toBe(integrityError);
    expect(incidents).toEqual([integrityError]);
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
        organizationId: "org-1",
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

test("API-supplied policy bundles hard-fail when signed permissions are tampered", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-api-tampering",
  );

  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    const firstMember = bundle.currentProjection[0];
    if (!firstMember) {
      throw new Error("Expected a principal policy member");
    }
    const tamperedBundle: typeof bundle = {
      ...bundle,
      currentProjection: [
        {
          ...firstMember,
          role: firstMember.role === "admin" ? "member" : "admin",
        },
        ...bundle.currentProjection.slice(1),
      ],
    };

    await expect(
      cachePrincipalPolicyBundles({
        bundles: [tamperedBundle],
        execSql,
        organizationId: "org-1",
        getCurrentPrincipalPolicy: async () => null,
        reportSecurityIncident: async () => undefined,
        resolveTrustedUserIdentity: async () =>
          trustedUserIdentityFromResponse(signerKeyResponse),
      }),
    ).rejects.toMatchObject({
      code: "hash_mismatch",
      name: "KeyingVerificationError",
    });
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

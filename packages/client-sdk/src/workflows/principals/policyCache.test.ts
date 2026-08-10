import { expect, test } from "bun:test";
import {
  buildInitialGroupPolicyRequest,
  buildInitialOrganizationPolicyRequest,
} from "@tearleads/client-sdk";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  cacheReferencedPolicies,
  createPrincipalPolicyBundle,
  createSuccessorPrincipalPolicyBundle,
  createUnauthorizedSuccessorPrincipalPolicyBundle,
  predecessorBundleFromSuccessor,
  principalPolicyBundleFromInitialPolicy,
  referencedPrincipalStateFromBundle,
  referencedPrincipalStateFromPolicyState,
} from "../../../test/helpers/policyCacheFixtures";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyBundle,
  loadPrincipalPolicyStateHash,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";

test("principal policy sync caches a verified referenced principal bundle and skips refetching unchanged state", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    let getCurrentPrincipalPolicyCallCount = 0;

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => {
        getCurrentPrincipalPolicyCallCount += 1;
        return bundle;
      },
      getUserIdentity: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    await expect(
      loadPrincipalPolicyStateHash(execSql, "group", "group-1"),
    ).resolves.toBe(bundle.currentState.stateHash);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => {
        getCurrentPrincipalPolicyCallCount += 1;
        return bundle;
      },
      getUserIdentity: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(getCurrentPrincipalPolicyCallCount).toBe(1);
  } finally {
    close();
  }
});

test("principal policy sync fetches a newer referenced state when an older bundle is cached", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      predecessorBundleFromSuccessor(bundle),
      "2026-04-08T00:00:30.000Z",
    );
    let getCurrentPrincipalPolicyCallCount = 0;

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => {
        getCurrentPrincipalPolicyCallCount += 1;
        return bundle;
      },
      getUserIdentity: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(getCurrentPrincipalPolicyCallCount).toBe(1);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("principal policy sync authorizes empty group bundles from verified organization admins", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const organizationId = "organization-1";
    const groupId = "group-empty-1";
    const adminGroupId = "admins-group-1";
    const signerUserId = "organization-admin-1";
    const signingKeyPair = generateSigningSeedAndKeyPair();
    const encapsulationKeyPair = generateKemSeedAndKeyPair();
    const signingKeyFingerprint = await toFingerprint(
      signingKeyPair.signingPublicKey,
    );
    const encapsulationKeyFingerprint = await toFingerprint(
      encapsulationKeyPair.publicKey,
    );
    const signerKeyResponse = {
      encapsulationKeyFingerprint,
      userId: signerUserId,
      signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
      signingKeyFingerprint,
      encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
    };
    const organizationPolicy = await principalPolicyBundleFromInitialPolicy({
      principalId: organizationId,
      policy: await buildInitialOrganizationPolicyRequest({
        adminGroupId,
        encapsulationPublicKey: encapsulationKeyPair.publicKey,
        memberGroupId: "members-group-1",
        organizationId,
        signingKeyPair,
        userId: signerUserId,
      }),
    });
    const adminPolicy = await principalPolicyBundleFromInitialPolicy({
      principalId: adminGroupId,
      policy: (
        await buildInitialGroupPolicyRequest({
          creatorEncapsulationKeyPair: encapsulationKeyPair,
          groupId: adminGroupId,
          name: "Admins",
          signerUserId,
          signingFingerprint: signingKeyFingerprint,
          signingKeyPair,
        })
      ).initialGroupPolicy,
    });
    const groupPolicy = await principalPolicyBundleFromInitialPolicy({
      principalId: groupId,
      policy: (
        await buildInitialGroupPolicyRequest({
          creatorEncapsulationKeyPair: encapsulationKeyPair,
          externalAuthority: {
            principalType: "group",
            principalId: adminPolicy.currentState.principalId,
            version: adminPolicy.currentState.version,
            keyEpoch: adminPolicy.currentState.keyEpoch,
            stateHash: adminPolicy.currentState.stateHash,
            keyFingerprint: adminPolicy.currentState.keyFingerprint,
          },
          groupId,
          includeSignerAsAdmin: false,
          name: "Operators",
          signerUserId,
          signingFingerprint: signingKeyFingerprint,
          signingKeyPair,
        })
      ).initialGroupPolicy,
    });
    const logs: string[] = [];

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        if (
          principalType === "organization" &&
          principalId === organizationId
        ) {
          return organizationPolicy;
        }
        if (principalType === "group" && principalId === adminGroupId) {
          return adminPolicy;
        }

        expect(principalType).toBe("group");
        expect(principalId).toBe(groupId);
        return groupPolicy;
      },
      getUserIdentity: async (userId) => {
        expect(userId).toBe(signerUserId);
        return signerKeyResponse;
      },
      log: (message) => logs.push(message),
      organizationId,
      references: [referencedPrincipalStateFromBundle(groupPolicy)],
    });

    expect(logs).toEqual([]);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", groupId),
    ).resolves.toEqual(groupPolicy);
    await expect(
      loadPrincipalPolicyBundle(execSql, "organization", organizationId),
    ).resolves.toEqual(organizationPolicy);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", adminGroupId),
    ).resolves.toEqual(adminPolicy);
  } finally {
    close();
  }
});

test("principal policy sync verifies successor state from the fetched chain when no previous bundle is cached", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    const logs: string[] = [];

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getUserIdentity: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(logs).toEqual([]);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("principal policy sync caches current state when the reference points at a historical head", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    const previousState = bundle.previousStates[0]?.state;
    if (!previousState) {
      throw new Error("expected previous principal policy state");
    }
    const logs: string[] = [];

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getUserIdentity: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromPolicyState(previousState)],
    });

    expect(logs).toEqual([]);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("principal policy sync reuses and re-verifies a cached successor for a historical reference", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-cached-successor-history",
  );

  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    const previousState = bundle.previousStates[0]?.state;
    if (!previousState) {
      throw new Error("expected previous principal policy state");
    }
    let policyReadCount = 0;
    let signerReadCount = 0;
    const cache = (
      references: Parameters<typeof cacheReferencedPolicies>[0]["references"],
    ) =>
      cacheReferencedPolicies({
        execSql,
        getCurrentPrincipalPolicy: async () => {
          policyReadCount += 1;
          return bundle;
        },
        getUserIdentity: async () => {
          signerReadCount += 1;
          return signerKeyResponse;
        },
        references,
      });

    await cache([referencedPrincipalStateFromBundle(bundle)]);
    await cache([referencedPrincipalStateFromPolicyState(previousState)]);

    expect(policyReadCount).toBe(1);
    // Reusing the stored bundle still runs normal signature verification; it is
    // a network-read optimization, not a trusted-object shortcut.
    expect(signerReadCount).toBe(2);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("principal policy sync skips shrinking successors that reuse the key epoch", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle({
        shrinkWithoutRotation: true,
      });
    const logs: string[] = [];

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getUserIdentity: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(logs).toContain(
      "Principal policy cache: skipped group:group-1: Principal policy shrink requires a new key epoch and key material",
    );
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("principal policy sync skips bundles whose projection does not match the signed root", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);
    const logs: string[] = [];
    const [firstProjectionMember, ...remainingProjection] =
      bundle.currentProjection;
    if (!firstProjectionMember) {
      throw new Error("expected principal policy projection member");
    }
    const tamperedBundle: PrincipalPolicyBundleResponse = {
      ...bundle,
      currentProjection: [
        {
          ...firstProjectionMember,
          role: firstProjectionMember.role === "admin" ? "member" : "admin",
        },
        ...remainingProjection,
      ],
    };

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => tamperedBundle,
      getUserIdentity: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(logs).toContain(
      "Principal policy cache: skipped group:group-1: principal policy projection root does not match projection",
    );
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("principal policy sync skips successor bundles signed by non-admins", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponses } =
      await createUnauthorizedSuccessorPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);
    const logs: string[] = [];

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getUserIdentity: async (userId) => signerKeyResponses.get(userId) ?? null,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(logs).toContain(
      "Principal policy cache: skipped group:group-1: principal policy state signer is not an admin in previous projection",
    );
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("principal policy sync skips bundles when the signer key does not match", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getUserIdentity: async () => ({
        ...signerKeyResponse,
        signingKeyFingerprint: "mismatched-fingerprint",
      }),
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

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

function predecessorBundleFromSuccessor(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse {
  const previous = bundle.previousStates[0];
  if (!previous) {
    throw new Error("Expected successor bundle to include previous state.");
  }

  return {
    currentMemberEnvelopes: {
      principalType: previous.state.principalType,
      principalId: previous.state.principalId,
      stateHash: previous.state.stateHash,
      epoch: previous.state.keyEpoch,
      envelopes: [],
    },
    currentPayload: {
      principalType: previous.state.principalType,
      principalId: previous.state.principalId,
      stateHash: previous.state.stateHash,
      cipherSuite: "aes-256-gcm",
      ciphertext: "cached-previous-ciphertext",
      ciphertextHash: previous.state.payloadCiphertextHash,
      createdAt: previous.state.createdAt,
    },
    currentProjection: previous.projection,
    currentState: previous.state,
    previousStates: [],
  };
}

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
        encapsulationPublicKey: encapsulationKeyPair.publicKey,
        organizationId,
        signingKeyPair,
        userId: signerUserId,
      }),
    });
    const groupPolicy = await principalPolicyBundleFromInitialPolicy({
      principalId: groupId,
      policy: (
        await buildInitialGroupPolicyRequest({
          creatorEncapsulationKeyPair: encapsulationKeyPair,
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

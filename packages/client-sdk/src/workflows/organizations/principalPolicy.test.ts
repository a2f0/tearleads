import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type PrincipalPolicySignerPublicKey,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
} from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import { buildInitialOrganizationPolicyRequest } from "../registration/registerIdentity";
import {
  buildAddGroupUserPolicyRequest,
  buildRemoveGroupUserPolicyRequest,
} from "./groupPolicyRequests";
import { importOrganizationUser } from "./organizationUserImport";
import {
  buildInitialGroupPolicyRequest,
  createOrganizationGroup,
} from "./principalPolicy";

function policySignerPublicKeys(input: {
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: ReturnType<typeof generateSigningSeedAndKeyPair>;
}): PrincipalPolicySignerPublicKey[] {
  return [
    {
      userId: input.signerUserId,
      signingKeyFingerprint: input.signingFingerprint,
      signingPublicKey: input.signingKeyPair.signingPublicKey,
    },
  ];
}

test("buildInitialGroupPolicyRequest creates an admin-only initial group policy", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );

  const request = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: encapsulationKeyPair,
    groupId,
    name: " Operators ",
    signerUserId: userId,
    signingFingerprint,
    signingKeyPair,
  });

  expect(request.name).toBe("Operators");
  expect(request.initialGroupPolicy.state.principalType).toBe("group");
  expect(request.initialGroupPolicy.state.principalId).toBe(groupId);
  expect(request.initialGroupPolicy.state.version).toBe(1);
  expect(request.initialGroupPolicy.projection).toEqual([
    {
      userId: userId,
      role: "admin",
    },
  ]);
  expect(request.initialGroupPolicy.memberEnvelopes[0]?.userId).toBe(userId);
});

test("buildInitialGroupPolicyRequest can create an externally-administered empty initial group policy", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );

  const request = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: encapsulationKeyPair,
    groupId,
    includeSignerAsAdmin: false,
    name: " Operators ",
    signerUserId: userId,
    signingFingerprint,
    signingKeyPair,
  });

  expect(request.name).toBe("Operators");
  expect(request.initialGroupPolicy.state.principalType).toBe("group");
  expect(request.initialGroupPolicy.state.principalId).toBe(groupId);
  expect(request.initialGroupPolicy.state.version).toBe(1);
  expect(request.initialGroupPolicy.state.memberCount).toBe(0);
  expect(request.initialGroupPolicy.projection).toEqual([]);
  expect(request.initialGroupPolicy.memberEnvelopes).toEqual([]);
});

test("importOrganizationUser resolves a trusted identity by id", async () => {
  const userId = crypto.randomUUID();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signingKeyFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const identity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(
      encapsulationKeyPair.publicKey,
    ),
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    signingKeyFingerprint,
    signingPublicKey: signingKeyPair.signingPublicKey,
    userId,
  });
  const imported = await importOrganizationUser({
    resolveTrustedUserIdentity: async (requestedUserId) =>
      requestedUserId === userId ? identity : null,
    userId: ` ${userId} `,
  });

  expect(imported).toEqual({ userId });
});

test("createOrganizationGroup caches the created group policy in a fresh local database", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const creatorKem = generateKemSeedAndKeyPair();
  const organizationId = crypto.randomUUID();
  const signerUserId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const adminGroupId = crypto.randomUUID();
  const memberGroupId = crypto.randomUUID();
  const adminPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: creatorKem,
      groupId: adminGroupId,
      name: "Admins",
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    }),
  );
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId,
      encapsulationPublicKey: creatorKem.publicKey,
      memberGroupId,
      organizationId,
      signingKeyPair,
      userId: signerUserId,
    }),
  );
  const { close, execSql } = await createTestExecSql(
    "organization-create-group-policy-cache-test",
  );
  let createdPolicyBundle: PrincipalPolicyBundleResponse | null = null;
  const apiClient: Parameters<typeof createOrganizationGroup>[0]["apiClient"] =
    {
      createOrganizationGroup: async (nextOrganizationId, request) => {
        await expect(
          loadPrincipalPolicyCheckpoint(
            execSql,
            "organization",
            organizationId,
          ),
        ).resolves.toMatchObject({
          version: organizationPolicy.currentState.version,
          stateHash: organizationPolicy.currentState.stateHash,
        });
        await expect(
          loadPrincipalPolicyCheckpoint(execSql, "group", adminGroupId),
        ).resolves.toMatchObject({
          version: adminPolicy.currentState.version,
          stateHash: adminPolicy.currentState.stateHash,
        });
        expect(request.initialGroupPolicy.state.memberCount).toBe(0);
        expect(request.initialGroupPolicy.projection).toEqual([]);
        expect(request.initialGroupPolicy.memberEnvelopes).toEqual([]);
        createdPolicyBundle = await policyBundleFromInitialRequest(request);

        return {
          groupId: request.groupId,
          organizationId: nextOrganizationId,
          name: request.name,
          createdAt: "2026-05-12T12:00:00.000Z",
          isBuiltin: false,
          currentState: {
            stateHash: createdPolicyBundle.currentState.stateHash,
            version: createdPolicyBundle.currentState.version,
            keyEpoch: createdPolicyBundle.currentState.keyEpoch,
            keyFingerprint: createdPolicyBundle.currentState.keyFingerprint,
            memberCount: createdPolicyBundle.currentState.memberCount,
          },
        };
      },
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        if (principalType === "organization") {
          expect(principalId).toBe(organizationId);
          return organizationPolicy;
        }
        if (principalId === adminGroupId) {
          return adminPolicy;
        }
        expect(createdPolicyBundle).not.toBeNull();
        if (!createdPolicyBundle) {
          return null;
        }

        expect(principalType).toBe("group");
        expect(principalId).toBe(createdPolicyBundle.currentState.principalId);
        return createdPolicyBundle;
      },
      putPrincipalPolicy: async () => {
        throw new Error("unexpected policy mutation");
      },
    };

  try {
    const createdGroup = await createOrganizationGroup({
      apiClient,
      creatorEncapsulationKeyPair: creatorKem,
      execSql,
      name: " Operators ",
      organizationId,
      resolveTrustedUserIdentity: async (userId) =>
        userId === signerUserId
          ? createTestTrustedUserIdentity({
              encapsulationKeyFingerprint: await toFingerprint(
                creatorKem.publicKey,
              ),
              encapsulationPublicKey: creatorKem.publicKey,
              signingKeyFingerprint: signingFingerprint,
              signingPublicKey: signingKeyPair.signingPublicKey,
              userId: signerUserId,
            })
          : null,
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    });

    expect(createdGroup.name).toBe("Operators");
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", createdGroup.groupId),
    ).resolves.toEqual(createdPolicyBundle);
    if (!createdGroup.currentState) {
      throw new Error("Expected created group policy head");
    }
    await expect(
      loadPrincipalPolicyCheckpoint(execSql, "group", createdGroup.groupId),
    ).resolves.toEqual({
      principalType: "group",
      principalId: createdGroup.groupId,
      version: createdGroup.currentState.version,
      stateHash: createdGroup.currentState.stateHash,
    });
    await expect(
      loadPrincipalPolicyBundle(execSql, "organization", organizationId),
    ).resolves.toEqual(organizationPolicy);
    await expect(
      loadPrincipalPolicyCheckpoint(execSql, "organization", organizationId),
    ).resolves.toEqual({
      principalType: "organization",
      principalId: organizationId,
      version: organizationPolicy.currentState.version,
      stateHash: organizationPolicy.currentState.stateHash,
    });
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", adminGroupId),
    ).resolves.toEqual(adminPolicy);
    await expect(
      loadPrincipalPolicyCheckpoint(execSql, "group", adminGroupId),
    ).resolves.toEqual({
      principalType: "group",
      principalId: adminGroupId,
      version: adminPolicy.currentState.version,
      stateHash: adminPolicy.currentState.stateHash,
    });
  } finally {
    close();
  }
});

test("group add and remove policy builders preserve additive epochs and rotate shrink epochs", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const creatorKem = generateKemSeedAndKeyPair();
  const targetKem = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const targetUserId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const initialRequest = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: creatorKem,
    groupId: crypto.randomUUID(),
    name: "Operators",
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const initialPolicy = await policyBundleFromInitialRequest(initialRequest);
  const currentPolicySignerPublicKeys = policySignerPublicKeys({
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });

  const addRequest = await buildAddGroupUserPolicyRequest({
    currentPolicy: initialPolicy,
    currentPolicySignerPublicKeys,
    currentUsers: [],
    currentUserSecretKey: creatorKem.secretKey,
    localPolicyCheckpoint: null,
    signerUserId,
    signingFingerprint,
    signingKeyPair,
    targetUser: createTestTrustedUserIdentity({
      userId: targetUserId,
      encapsulationPublicKey: targetKem.publicKey,
      encapsulationKeyFingerprint: await toFingerprint(targetKem.publicKey),
      signingKeyFingerprint: signingFingerprint,
      signingPublicKey: signingKeyPair.signingPublicKey,
    }),
  });

  expect(addRequest.state.keyEpoch).toBe(1);
  expect(addRequest.projection.map((member) => member.userId)).toContain(
    targetUserId,
  );
  expect(addRequest.memberEnvelopes).toHaveLength(2);

  const addStateHash = await computePrincipalStateHash(addRequest.state);
  const addedPolicy: PrincipalPolicyBundleResponse = {
    ...initialPolicy,
    currentState: {
      ...addRequest.state,
      stateHash: addStateHash,
      createdAt: new Date("2026-05-12T12:01:00.000Z").toISOString(),
    },
    currentPayload: {
      principalType: "group",
      principalId: initialRequest.groupId,
      stateHash: addStateHash,
      cipherSuite: addRequest.encryptedPayload.cipherSuite,
      ciphertext: addRequest.encryptedPayload.ciphertext,
      ciphertextHash: addRequest.encryptedPayload.ciphertextHash,
      createdAt: new Date("2026-05-12T12:01:00.000Z").toISOString(),
    },
    currentProjection: addRequest.projection,
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: initialRequest.groupId,
      stateHash: addStateHash,
      epoch: addRequest.state.keyEpoch,
      envelopes: [...addRequest.memberEnvelopes],
    },
    previousStates: [
      {
        state: initialPolicy.currentState,
        projection: initialPolicy.currentProjection,
      },
    ],
  };

  const removeRequest = await buildRemoveGroupUserPolicyRequest({
    currentPolicy: addedPolicy,
    currentPolicySignerPublicKeys,
    localPolicyCheckpoint: {
      principalType: initialPolicy.currentState.principalType,
      principalId: initialPolicy.currentState.principalId,
      version: initialPolicy.currentState.version,
      stateHash: initialPolicy.currentState.stateHash,
    },
    remainingUsers: [
      createTestTrustedUserIdentity({
        userId: signerUserId,
        encapsulationPublicKey: creatorKem.publicKey,
        encapsulationKeyFingerprint: await toFingerprint(creatorKem.publicKey),
        signingKeyFingerprint: signingFingerprint,
        signingPublicKey: signingKeyPair.signingPublicKey,
      }),
    ],
    removedUserId: targetUserId,
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });

  expect(removeRequest.state.keyEpoch).toBe(2);
  expect(
    removeRequest.projection.some((member) => member.userId === targetUserId),
  ).toBe(false);
  expect(removeRequest.memberEnvelopes).toHaveLength(1);
  expect(removeRequest.memberEnvelopes[0]?.userId).toBe(signerUserId);
});

test("group mutation builders reject tampered server policy projections", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const creatorKem = generateKemSeedAndKeyPair();
  const targetKem = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const targetUserId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const initialRequest = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: creatorKem,
    groupId: crypto.randomUUID(),
    name: "Operators",
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const initialPolicy = await policyBundleFromInitialRequest(initialRequest);
  const tamperedPolicy: PrincipalPolicyBundleResponse = {
    ...initialPolicy,
    currentProjection: [
      ...initialPolicy.currentProjection,
      {
        userId: "server-injected-user",
        role: "admin",
      },
    ],
  };

  await expect(
    buildAddGroupUserPolicyRequest({
      currentPolicy: tamperedPolicy,
      currentPolicySignerPublicKeys: policySignerPublicKeys({
        signerUserId,
        signingFingerprint,
        signingKeyPair,
      }),
      currentUsers: [],
      currentUserSecretKey: creatorKem.secretKey,
      localPolicyCheckpoint: null,
      signerUserId,
      signingFingerprint,
      signingKeyPair,
      targetUser: createTestTrustedUserIdentity({
        userId: targetUserId,
        encapsulationPublicKey: targetKem.publicKey,
        encapsulationKeyFingerprint: await toFingerprint(targetKem.publicKey),
        signingKeyFingerprint: signingFingerprint,
        signingPublicKey: signingKeyPair.signingPublicKey,
      }),
    }),
  ).rejects.toMatchObject({
    code: "hash_mismatch",
    name: "KeyingVerificationError",
  });
});

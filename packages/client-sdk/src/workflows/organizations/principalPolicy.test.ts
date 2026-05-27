import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type PrincipalPolicySignerPublicKey,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import {
  buildAddGroupUserPolicyRequest,
  buildInitialGroupPolicyRequest,
  buildRemoveGroupUserPolicyRequest,
  createOrganizationGroup,
  importOrganizationUserRecipient,
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

async function policyBundleFromInitialRequest(
  request: Awaited<ReturnType<typeof buildInitialGroupPolicyRequest>>,
): Promise<PrincipalPolicyBundleResponse> {
  const stateHash = await computePrincipalStateHash(
    request.initialGroupPolicy.state,
  );

  return {
    currentState: {
      ...request.initialGroupPolicy.state,
      stateHash,
      createdAt: new Date("2026-05-12T12:00:00.000Z").toISOString(),
    },
    currentPayload: {
      principalType: "group",
      principalId: request.groupId,
      stateHash,
      cipherSuite: request.initialGroupPolicy.encryptedPayload.cipherSuite,
      ciphertext: request.initialGroupPolicy.encryptedPayload.ciphertext,
      ciphertextHash:
        request.initialGroupPolicy.encryptedPayload.ciphertextHash,
      createdAt: new Date("2026-05-12T12:00:00.000Z").toISOString(),
    },
    currentProjection: request.initialGroupPolicy.projection,
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: request.groupId,
      stateHash,
      epoch: request.initialGroupPolicy.state.keyEpoch,
      envelopes: request.initialGroupPolicy.memberEnvelopes,
    },
    previousStates: [],
  };
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
      memberPrincipalType: "user",
      memberPrincipalId: userId,
      role: "admin",
    },
  ]);
  expect(request.initialGroupPolicy.memberEnvelopes[0]?.memberPrincipalId).toBe(
    userId,
  );
});

test("importOrganizationUserRecipient loads a user key by id", async () => {
  const userId = crypto.randomUUID();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const encapsulationPublicKey = bytesToBase64(encapsulationKeyPair.publicKey);
  const recipient = await importOrganizationUserRecipient({
    apiClient: {
      getEncapsulationKey: async (requestedUserId) =>
        requestedUserId === userId
          ? {
              userId,
              signingPublicKey: "signing-public-key",
              signingKeyFingerprint: "0".repeat(64),
              encapsulationPublicKey,
            }
          : null,
    },
    userId: ` ${userId} `,
  });

  expect(recipient).toEqual({
    userId,
    encapsulationPublicKey,
    encapsulationKeyFingerprint: await toFingerprint(
      encapsulationKeyPair.publicKey,
    ),
  });
});

test("createOrganizationGroup caches the created group policy in a fresh local database", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const creatorKem = generateKemSeedAndKeyPair();
  const organizationId = crypto.randomUUID();
  const signerUserId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const { close, execSql } = await createTestExecSql(
    "organization-create-group-policy-cache-test",
  );
  let createdPolicyBundle: PrincipalPolicyBundleResponse | null = null;
  const apiClient: Parameters<typeof createOrganizationGroup>[0]["apiClient"] =
    {
      createOrganizationGroup: async (nextOrganizationId, request) => {
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
            memberCount: createdPolicyBundle.currentState.memberCount,
          },
        };
      },
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        expect(createdPolicyBundle).not.toBeNull();
        if (!createdPolicyBundle) {
          return null;
        }

        expect(principalType).toBe("group");
        expect(principalId).toBe(createdPolicyBundle.currentState.principalId);
        return createdPolicyBundle;
      },
      getEncapsulationKey: async () => {
        throw new Error("unexpected signer key load");
      },
      putPrincipalMemberEnvelopes: async () => {
        throw new Error("unexpected member envelope mutation");
      },
      putPrincipalState: async () => {
        throw new Error("unexpected state mutation");
      },
    };

  try {
    const createdGroup = await createOrganizationGroup({
      apiClient,
      creatorEncapsulationKeyPair: creatorKem,
      execSql,
      name: " Operators ",
      organizationId,
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    });

    expect(createdGroup.name).toBe("Operators");
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", createdGroup.groupId),
    ).resolves.toEqual(createdPolicyBundle);
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
    canAdministerOrganization: true,
    currentPolicy: initialPolicy,
    currentPolicySignerPublicKeys,
    currentUsers: [],
    currentUserSecretKey: creatorKem.secretKey,
    localPolicyCheckpoint: null,
    signerUserId,
    signingFingerprint,
    signingKeyPair,
    targetUser: {
      userId: targetUserId,
      encapsulationPublicKey: bytesToBase64(targetKem.publicKey),
      encapsulationKeyFingerprint: await toFingerprint(targetKem.publicKey),
    },
  });

  expect(addRequest.state.state.keyEpoch).toBe(1);
  expect(
    addRequest.state.projection.map((member) => member.memberPrincipalId),
  ).toContain(targetUserId);
  expect(addRequest.memberEnvelopes).toHaveLength(2);

  const addStateHash = await computePrincipalStateHash(addRequest.state.state);
  const addedPolicy: PrincipalPolicyBundleResponse = {
    ...initialPolicy,
    currentState: {
      ...addRequest.state.state,
      stateHash: addStateHash,
      createdAt: new Date("2026-05-12T12:01:00.000Z").toISOString(),
    },
    currentPayload: {
      principalType: "group",
      principalId: initialRequest.groupId,
      stateHash: addStateHash,
      cipherSuite: addRequest.state.encryptedPayload.cipherSuite,
      ciphertext: addRequest.state.encryptedPayload.ciphertext,
      ciphertextHash: addRequest.state.encryptedPayload.ciphertextHash,
      createdAt: new Date("2026-05-12T12:01:00.000Z").toISOString(),
    },
    currentProjection: addRequest.state.projection,
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: initialRequest.groupId,
      stateHash: addStateHash,
      epoch: addRequest.state.state.keyEpoch,
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
    canAdministerOrganization: false,
    currentPolicy: addedPolicy,
    currentPolicySignerPublicKeys,
    localPolicyCheckpoint: {
      principalType: initialPolicy.currentState.principalType,
      principalId: initialPolicy.currentState.principalId,
      version: initialPolicy.currentState.version,
      stateHash: initialPolicy.currentState.stateHash,
    },
    remainingUsers: [
      {
        userId: signerUserId,
        encapsulationPublicKey: bytesToBase64(creatorKem.publicKey),
        encapsulationKeyFingerprint: await toFingerprint(creatorKem.publicKey),
      },
    ],
    removedUserId: targetUserId,
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });

  expect(removeRequest.state.state.keyEpoch).toBe(2);
  expect(
    removeRequest.state.projection.some(
      (member) => member.memberPrincipalId === targetUserId,
    ),
  ).toBe(false);
  expect(removeRequest.memberEnvelopes).toHaveLength(1);
  expect(removeRequest.memberEnvelopes[0]?.memberPrincipalId).toBe(
    signerUserId,
  );
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
        memberPrincipalType: "user",
        memberPrincipalId: "server-injected-user",
        role: "admin",
      },
    ],
  };

  await expect(
    buildAddGroupUserPolicyRequest({
      canAdministerOrganization: false,
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
      targetUser: {
        userId: targetUserId,
        encapsulationPublicKey: bytesToBase64(targetKem.publicKey),
        encapsulationKeyFingerprint: await toFingerprint(targetKem.publicKey),
      },
    }),
  ).rejects.toThrow("Group policy verification failed");
});

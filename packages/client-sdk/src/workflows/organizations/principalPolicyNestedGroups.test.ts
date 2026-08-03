import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  KeyingVerificationError,
  type PrincipalPolicySignerPublicKey,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
} from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { persistVerifiedPrincipalPolicyBundlesAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { buildInitialOrganizationPolicyRequest } from "../registration/registerIdentity";
import { verifyGroupPolicy } from "./groupPolicyVerification";
import {
  buildAddGroupUserPolicyRequest,
  buildInitialGroupPolicyRequest,
  buildInitialMemberGroupPolicyRequest,
  buildRemoveGroupUserPolicyRequest,
  removeOrganizationGroupUser,
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

test("group remove policy builder rekeys remaining nested group members", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const creatorKem = generateKemSeedAndKeyPair();
  const targetKem = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const targetUserId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const initialAdminGroup = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: creatorKem,
    groupId: crypto.randomUUID(),
    name: "Admins",
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const initialMemberGroup = await buildInitialMemberGroupPolicyRequest({
    adminGroup: initialAdminGroup,
    creatorEncapsulationKeyPair: creatorKem,
    groupId: crypto.randomUUID(),
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const initialMemberPolicy =
    await policyBundleFromInitialRequest(initialMemberGroup);
  const initialAdminPolicy =
    await policyBundleFromInitialRequest(initialAdminGroup);
  const currentPolicySignerPublicKeys = policySignerPublicKeys({
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });

  const addRequest = await buildAddGroupUserPolicyRequest({
    currentPolicy: initialMemberPolicy,
    currentPolicySignerPublicKeys,
    currentUsers: [
      createTestTrustedUserIdentity({
        userId: signerUserId,
        encapsulationPublicKey: creatorKem.publicKey,
        encapsulationKeyFingerprint: await toFingerprint(creatorKem.publicKey),
        signingKeyFingerprint: signingFingerprint,
        signingPublicKey: signingKeyPair.signingPublicKey,
      }),
    ],
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
  const addStateHash = await computePrincipalStateHash(addRequest.state);
  const addedPolicy: PrincipalPolicyBundleResponse = {
    ...initialMemberPolicy,
    currentState: {
      ...addRequest.state,
      stateHash: addStateHash,
      createdAt: new Date("2026-05-12T12:01:00.000Z").toISOString(),
    },
    currentPayload: {
      principalType: "group",
      principalId: initialMemberGroup.groupId,
      stateHash: addStateHash,
      cipherSuite: addRequest.encryptedPayload.cipherSuite,
      ciphertext: addRequest.encryptedPayload.ciphertext,
      ciphertextHash: addRequest.encryptedPayload.ciphertextHash,
      createdAt: new Date("2026-05-12T12:01:00.000Z").toISOString(),
    },
    currentProjection: addRequest.projection,
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: initialMemberGroup.groupId,
      stateHash: addStateHash,
      epoch: addRequest.state.keyEpoch,
      envelopes: [...addRequest.memberEnvelopes],
    },
    previousStates: [
      {
        state: initialMemberPolicy.currentState,
        projection: initialMemberPolicy.currentProjection,
      },
    ],
  };

  const removeRequest = await buildRemoveGroupUserPolicyRequest({
    currentPolicy: addedPolicy,
    currentPolicySignerPublicKeys,
    localPolicyCheckpoint: null,
    remainingGroups: [
      await verifyGroupPolicy({
        currentPolicy: initialAdminPolicy,
        localPolicyCheckpoint: null,
        signerPublicKeys: currentPolicySignerPublicKeys,
      }),
    ],
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
  expect(removeRequest.memberEnvelopes).toHaveLength(2);
  expect(removeRequest.memberEnvelopes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        userId: signerUserId,
      }),
      expect.objectContaining({
        userId: initialAdminGroup.groupId,
      }),
    ]),
  );
});

test("group removal rejects a server-substituted nested group key before mutation", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const creatorKem = generateKemSeedAndKeyPair();
  const removedUserKem = generateKemSeedAndKeyPair();
  const attackerKem = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const removedUserId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const initialAdminGroup = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: creatorKem,
    groupId: crypto.randomUUID(),
    name: "Admins",
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const initialMemberGroup = await buildInitialMemberGroupPolicyRequest({
    adminGroup: initialAdminGroup,
    creatorEncapsulationKeyPair: creatorKem,
    groupId: crypto.randomUUID(),
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const substitutedAdminGroup = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: attackerKem,
    groupId: initialAdminGroup.groupId,
    name: "Substituted admins",
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const adminPolicy = await policyBundleFromInitialRequest(initialAdminGroup);
  const substitutedAdminPolicy = await policyBundleFromInitialRequest(
    substitutedAdminGroup,
  );
  const memberPolicy = await policyBundleFromInitialRequest(initialMemberGroup);
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: initialAdminGroup.groupId,
      encapsulationPublicKey: creatorKem.publicKey,
      memberGroupId: initialMemberGroup.groupId,
      organizationId,
      signingKeyPair,
      userId: signerUserId,
    }),
  );
  const signerIdentity = createTestTrustedUserIdentity({
    userId: signerUserId,
    encapsulationPublicKey: creatorKem.publicKey,
    encapsulationKeyFingerprint: await toFingerprint(creatorKem.publicKey),
    signingKeyFingerprint: signingFingerprint,
    signingPublicKey: signingKeyPair.signingPublicKey,
  });
  const removedIdentity = createTestTrustedUserIdentity({
    userId: removedUserId,
    encapsulationPublicKey: removedUserKem.publicKey,
    encapsulationKeyFingerprint: await toFingerprint(removedUserKem.publicKey),
    signingKeyFingerprint: signingFingerprint,
    signingPublicKey: signingKeyPair.signingPublicKey,
  });
  const addRequest = await buildAddGroupUserPolicyRequest({
    currentPolicy: memberPolicy,
    currentPolicySignerPublicKeys: policySignerPublicKeys({
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    }),
    currentUsers: [signerIdentity],
    currentUserSecretKey: creatorKem.secretKey,
    localPolicyCheckpoint: null,
    signerUserId,
    signingFingerprint,
    signingKeyPair,
    targetUser: removedIdentity,
  });
  const currentPolicy = await policyBundleAfterMutation({
    mutation: addRequest,
    previous: memberPolicy,
  });
  expect(substitutedAdminPolicy.currentState.encapsulationPublicKey).not.toBe(
    adminPolicy.currentState.encapsulationPublicKey,
  );
  const writes = { policies: 0 };
  const { close, execSql } = await createTestExecSql(
    "organization-nested-group-substituted-key",
  );
  let beforePolicyCommitCalls = 0;

  try {
    const verifiedAdminPolicy = await verifyGroupPolicy({
      currentPolicy: adminPolicy,
      localPolicyCheckpoint: null,
      signerPublicKeys: policySignerPublicKeys({
        signerUserId,
        signingFingerprint,
        signingKeyPair,
      }),
    });
    await persistVerifiedPrincipalPolicyBundlesAtomically({
      entries: [{ bundle: adminPolicy, policy: verifiedAdminPolicy }],
      execSql,
      updatedAt: "2026-07-15T12:00:00.000Z",
    });
    const mutation = removeOrganizationGroupUser({
      afterPolicyCommitBeforeCache: async () => {
        throw new Error("Unexpected policy commit bridge");
      },
      apiClient: {
        createOrganizationGroup: async () => {
          throw new Error("Unexpected group creation");
        },
        getCurrentPrincipalPolicy: async (principalType, principalId) => {
          if (principalType === "organization") {
            return organizationPolicy;
          }
          if (principalId === currentPolicy.currentState.principalId) {
            return currentPolicy;
          }
          if (principalId === adminPolicy.currentState.principalId) {
            return substitutedAdminPolicy;
          }
          return null;
        },
        putPrincipalPolicy: async () => {
          writes.policies += 1;
          throw new Error("Unexpected principal policy mutation");
        },
      },
      beforePolicyCommit: () => {
        beforePolicyCommitCalls += 1;
      },
      execSql,
      groupId: currentPolicy.currentState.principalId,
      organizationId,
      removedUserId,
      resolveTrustedUserIdentity: async (userId) =>
        userId === signerUserId ? signerIdentity : null,
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    });

    let thrown: unknown;
    try {
      await mutation;
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KeyingVerificationError);
    expect(thrown).toMatchObject({
      code: "equivocation",
      message: expect.stringContaining("local checkpoint"),
    });
    expect(beforePolicyCommitCalls).toBe(0);
    expect(writes).toEqual({ policies: 0 });
    await expect(
      loadPrincipalPolicyCheckpoint(
        execSql,
        "group",
        adminPolicy.currentState.principalId,
      ),
    ).resolves.toEqual(verifiedAdminPolicy.checkpoint);
  } finally {
    close();
  }
});

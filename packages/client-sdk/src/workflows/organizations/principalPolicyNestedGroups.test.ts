import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type PrincipalPolicySignerPublicKey,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  buildAddGroupUserPolicyRequest,
  buildInitialGroupPolicyRequest,
  buildInitialMemberGroupPolicyRequest,
  buildRemoveGroupUserPolicyRequest,
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
  const currentPolicySignerPublicKeys = policySignerPublicKeys({
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });

  const addRequest = await buildAddGroupUserPolicyRequest({
    canAdministerOrganization: true,
    currentPolicy: initialMemberPolicy,
    currentPolicySignerPublicKeys,
    currentUsers: [
      {
        userId: signerUserId,
        encapsulationPublicKey: bytesToBase64(creatorKem.publicKey),
        encapsulationKeyFingerprint: await toFingerprint(creatorKem.publicKey),
      },
    ],
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
  const addStateHash = await computePrincipalStateHash(addRequest.state.state);
  const addedPolicy: PrincipalPolicyBundleResponse = {
    ...initialMemberPolicy,
    currentState: {
      ...addRequest.state.state,
      stateHash: addStateHash,
      createdAt: new Date("2026-05-12T12:01:00.000Z").toISOString(),
    },
    currentPayload: {
      principalType: "group",
      principalId: initialMemberGroup.groupId,
      stateHash: addStateHash,
      cipherSuite: addRequest.state.encryptedPayload.cipherSuite,
      ciphertext: addRequest.state.encryptedPayload.ciphertext,
      ciphertextHash: addRequest.state.encryptedPayload.ciphertextHash,
      createdAt: new Date("2026-05-12T12:01:00.000Z").toISOString(),
    },
    currentProjection: addRequest.state.projection,
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: initialMemberGroup.groupId,
      stateHash: addStateHash,
      epoch: addRequest.state.state.keyEpoch,
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
    canAdministerOrganization: true,
    currentPolicy: addedPolicy,
    currentPolicySignerPublicKeys,
    localPolicyCheckpoint: null,
    remainingGroups: [
      {
        groupId: initialAdminGroup.groupId,
        encapsulationPublicKey:
          initialAdminGroup.initialGroupPolicy.state.encapsulationPublicKey,
      },
    ],
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
  expect(removeRequest.memberEnvelopes).toHaveLength(2);
  expect(removeRequest.memberEnvelopes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        memberPrincipalId: signerUserId,
        memberPrincipalType: "user",
      }),
      expect.objectContaining({
        memberPrincipalId: initialAdminGroup.groupId,
        memberPrincipalType: "group",
      }),
    ]),
  );
});

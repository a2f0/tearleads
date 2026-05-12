import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  buildAddGroupUserPolicyRequest,
  buildInitialGroupPolicyRequest,
  buildRemoveGroupUserPolicyRequest,
} from "./principalPolicy";

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

  const addRequest = await buildAddGroupUserPolicyRequest({
    currentPolicy: initialPolicy,
    currentUserSecretKey: creatorKem.secretKey,
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
  expect(addRequest.memberEnvelopes.envelopes).toHaveLength(2);

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
      envelopes: addRequest.memberEnvelopes.envelopes,
    },
  };

  const removeRequest = await buildRemoveGroupUserPolicyRequest({
    currentPolicy: addedPolicy,
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
  expect(removeRequest.memberEnvelopes.envelopes).toHaveLength(1);
  expect(removeRequest.memberEnvelopes.envelopes[0]?.memberPrincipalId).toBe(
    signerUserId,
  );
});

import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type PrincipalPolicySignerPublicKey,
  type ReferencedPrincipalHead,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  PrincipalMemberEnvelopeRequest,
  PutPrincipalStateRequest,
} from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { policyBundleFromInitialRequest } from "../../../test/helpers/principalPolicyFixtures";
import {
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";
import {
  addOrganizationGroupUser,
  buildAddGroupUserPolicyRequest,
  buildInitialGroupPolicyRequest,
  removeOrganizationGroupUser,
} from "./principalPolicy";

interface PolicyMutationArtifacts {
  memberEnvelopes: readonly PrincipalMemberEnvelopeRequest[];
  state: PutPrincipalStateRequest;
}

async function policyBundleAfterMutation(input: {
  mutation: PolicyMutationArtifacts;
  previous: PrincipalPolicyBundleResponse;
}): Promise<PrincipalPolicyBundleResponse> {
  const stateHash = await computePrincipalStateHash(input.mutation.state.state);
  const createdAt = input.mutation.state.state.signedAt;

  return {
    currentState: {
      ...input.mutation.state.state,
      stateHash,
      createdAt,
    },
    currentPayload: {
      principalType: "group",
      principalId: input.mutation.state.state.principalId,
      stateHash,
      cipherSuite: input.mutation.state.encryptedPayload.cipherSuite,
      ciphertext: input.mutation.state.encryptedPayload.ciphertext,
      ciphertextHash: input.mutation.state.encryptedPayload.ciphertextHash,
      createdAt,
    },
    currentProjection: [...input.mutation.state.projection],
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: input.mutation.state.state.principalId,
      stateHash,
      epoch: input.mutation.state.state.keyEpoch,
      envelopes: [...input.mutation.memberEnvelopes],
    },
    previousStates: [
      ...input.previous.previousStates,
      {
        state: input.previous.currentState,
        projection: input.previous.currentProjection,
      },
    ],
  };
}

function signerPublicKeys(input: {
  signerUserId: string;
  signingFingerprint: string;
  signingKeyPair: ReturnType<typeof generateSigningSeedAndKeyPair>;
}): PrincipalPolicySignerPublicKey[] {
  return [
    {
      userId: input.signerUserId,
      signingKeyFingerprint: input.signingFingerprint,
      signingPublicKey: input.signingKeyPair.signingPublicKey,
    },
  ];
}

test("remove group user bridges committed policy writes before caching the rotation", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const remainingUserKem = generateKemSeedAndKeyPair();
  const removedUserKem = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const removedUserId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const initialRequest = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: remainingUserKem,
    groupId,
    name: "Admins",
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const initialPolicy = await policyBundleFromInitialRequest(initialRequest);
  const addedMutation = await buildAddGroupUserPolicyRequest({
    canAdministerOrganization: false,
    currentPolicy: initialPolicy,
    currentPolicySignerPublicKeys: signerPublicKeys({
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    }),
    currentUsers: [],
    currentUserSecretKey: remainingUserKem.secretKey,
    localPolicyCheckpoint: null,
    signerUserId,
    signingFingerprint,
    signingKeyPair,
    targetUser: {
      userId: removedUserId,
      encapsulationPublicKey: bytesToBase64(removedUserKem.publicKey),
      encapsulationKeyFingerprint: await toFingerprint(
        removedUserKem.publicKey,
      ),
    },
  });
  const previousPolicy = await policyBundleAfterMutation({
    mutation: addedMutation,
    previous: initialPolicy,
  });
  const { close, execSql } = await createTestExecSql(
    "organization-principal-policy-commit-bridge",
  );
  const calls: string[] = [];
  let policyReadCount = 0;
  let pendingState: PutPrincipalStateRequest | null = null;
  let policyBeforePendingState: PrincipalPolicyBundleResponse | null = null;
  let boundHead: ReferencedPrincipalHead | null = null;
  let currentPolicy = previousPolicy;
  const apiClient: Parameters<
    typeof removeOrganizationGroupUser
  >[0]["apiClient"] = {
    createOrganizationGroup: async () => {
      throw new Error("Unexpected group create");
    },
    getCurrentPrincipalPolicy: async (principalType, principalId) => {
      expect(principalType).toBe("group");
      expect(principalId).toBe(groupId);
      policyReadCount += 1;
      calls.push(policyReadCount === 1 ? "read-previous" : "read-current");
      return currentPolicy;
    },
    getEncapsulationKey: async (userId) => {
      expect(userId).toBe(signerUserId);
      return {
        userId,
        signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
        signingKeyFingerprint: signingFingerprint,
        encapsulationPublicKey: bytesToBase64(remainingUserKem.publicKey),
      };
    },
    putPrincipalState: async (principalType, principalId, input) => {
      expect(principalType).toBe("group");
      expect(principalId).toBe(groupId);
      calls.push("put-state");
      policyBeforePendingState = currentPolicy;
      pendingState = input;
      return {
        ...input.state,
        stateHash: await computePrincipalStateHash(input.state),
        createdAt: input.state.signedAt,
      };
    },
    putPrincipalMemberEnvelopes: async (principalType, principalId, input) => {
      expect(principalType).toBe("group");
      expect(principalId).toBe(groupId);
      calls.push("put-envelopes");
      if (!pendingState || !policyBeforePendingState) {
        throw new Error("Expected committed principal state");
      }
      currentPolicy = await policyBundleAfterMutation({
        mutation: {
          state: pendingState,
          memberEnvelopes: input.envelopes,
        },
        previous: policyBeforePendingState,
      });
      expect(input.stateHash).toBe(currentPolicy.currentState.stateHash);
      return currentPolicy.currentMemberEnvelopes;
    },
  };

  try {
    await savePrincipalPolicyBundle(
      execSql,
      previousPolicy,
      "2026-07-11T12:00:00.000Z",
    );

    const returnedPolicy = await removeOrganizationGroupUser({
      afterPolicyCommitBeforeCache: async () => {
        calls.push("bridge");
        expect(calls).toEqual([
          "read-previous",
          "bind-head",
          "put-state",
          "put-envelopes",
          "bridge",
        ]);
        expect(currentPolicy.currentState.keyEpoch).toBe(2);
        expect(boundHead).toEqual({
          principalType: "group",
          principalId: groupId,
          version: currentPolicy.currentState.version,
          keyEpoch: currentPolicy.currentState.keyEpoch,
          stateHash: currentPolicy.currentState.stateHash,
          keyFingerprint: currentPolicy.currentState.keyFingerprint,
        });
        const cachedDuringBridge = await loadPrincipalPolicyBundle(
          execSql,
          "group",
          groupId,
        );
        expect(cachedDuringBridge?.currentState.stateHash).toBe(
          previousPolicy.currentState.stateHash,
        );
        expect(cachedDuringBridge?.currentState.keyEpoch).toBe(1);
      },
      apiClient,
      beforePolicyCommit: (head) => {
        calls.push("bind-head");
        boundHead = head;
        expect(head).toEqual({
          principalType: "group",
          principalId: groupId,
          version: currentPolicy.currentState.version + 1,
          keyEpoch: currentPolicy.currentState.keyEpoch + 1,
          stateHash: expect.any(String),
          keyFingerprint: expect.any(String),
        });
      },
      canAdministerOrganization: false,
      execSql,
      groupId,
      remainingUsers: [
        {
          userId: signerUserId,
          encapsulationPublicKey: bytesToBase64(remainingUserKem.publicKey),
          encapsulationKeyFingerprint: await toFingerprint(
            remainingUserKem.publicKey,
          ),
        },
      ],
      removedUserId,
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    });

    expect(calls).toEqual([
      "read-previous",
      "bind-head",
      "put-state",
      "put-envelopes",
      "bridge",
      "read-current",
    ]);
    expect(returnedPolicy.currentState.stateHash).toBe(
      currentPolicy.currentState.stateHash,
    );
    const cachedAfterBridge = await loadPrincipalPolicyBundle(
      execSql,
      "group",
      groupId,
    );
    expect(cachedAfterBridge?.currentState.stateHash).toBe(
      currentPolicy.currentState.stateHash,
    );
    expect(cachedAfterBridge?.currentState.keyEpoch).toBe(2);

    const concurrentUserId = crypto.randomUUID();
    const concurrentUserKem = generateKemSeedAndKeyPair();
    const expectedAddHead: { current: ReferencedPrincipalHead | null } = {
      current: null,
    };
    await expect(
      addOrganizationGroupUser({
        afterPolicyCommitBeforeCache: async () => {
          await savePrincipalPolicyBundle(
            execSql,
            currentPolicy,
            "2026-07-11T12:01:00.000Z",
          );
          const concurrentMutation = await buildAddGroupUserPolicyRequest({
            canAdministerOrganization: false,
            currentPolicy,
            currentPolicySignerPublicKeys: signerPublicKeys({
              signerUserId,
              signingFingerprint,
              signingKeyPair,
            }),
            currentUsers: [],
            currentUserSecretKey: remainingUserKem.secretKey,
            localPolicyCheckpoint: null,
            signerUserId,
            signingFingerprint,
            signingKeyPair,
            targetUser: {
              userId: concurrentUserId,
              encapsulationPublicKey: bytesToBase64(
                concurrentUserKem.publicKey,
              ),
              encapsulationKeyFingerprint: await toFingerprint(
                concurrentUserKem.publicKey,
              ),
            },
          });
          currentPolicy = await policyBundleAfterMutation({
            mutation: concurrentMutation,
            previous: currentPolicy,
          });
        },
        apiClient,
        beforePolicyCommit: (head) => {
          expectedAddHead.current = head;
        },
        canAdministerOrganization: false,
        currentUsers: [],
        currentUserSecretKey: remainingUserKem.secretKey,
        execSql,
        groupId,
        signerUserId,
        signingFingerprint,
        signingKeyPair,
        targetUser: {
          userId: removedUserId,
          encapsulationPublicKey: bytesToBase64(removedUserKem.publicKey),
          encapsulationKeyFingerprint: await toFingerprint(
            removedUserKem.publicKey,
          ),
        },
      }),
    ).rejects.toThrow("Updated group policy advanced during root re-wrap");

    const cachedAfterConcurrentAdvance = await loadPrincipalPolicyBundle(
      execSql,
      "group",
      groupId,
    );
    const boundAddHead = expectedAddHead.current;
    expect(boundAddHead).not.toBeNull();
    if (!boundAddHead) {
      throw new Error("Expected the added policy head to be bound");
    }
    expect(cachedAfterConcurrentAdvance?.currentState.stateHash).toBe(
      boundAddHead.stateHash,
    );
    expect(cachedAfterConcurrentAdvance?.currentState.stateHash).not.toBe(
      currentPolicy.currentState.stateHash,
    );
  } finally {
    close();
  }
});

import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type PrincipalPolicySignerPublicKey,
  type ReferencedPrincipalHead,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
} from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import {
  loadAllPrincipalPolicyBundles,
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";
import { buildInitialOrganizationPolicyRequest } from "../registration/registerIdentity";
import {
  addOrganizationGroupUser,
  buildAddGroupUserPolicyRequest,
  buildInitialGroupPolicyRequest,
  removeOrganizationGroupUser,
} from "./principalPolicy";

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
  const organizationId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const adminGroupId = crypto.randomUUID();
  const memberGroupId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const initialRequest = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: remainingUserKem,
    groupId,
    name: "Operators",
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const initialPolicy = await policyBundleFromInitialRequest(initialRequest);
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId,
      encapsulationPublicKey: remainingUserKem.publicKey,
      memberGroupId,
      organizationId,
      signingKeyPair,
      userId: signerUserId,
    }),
  );
  const adminPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: remainingUserKem,
      groupId: adminGroupId,
      name: "Admins",
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    }),
  );
  const addedMutation = await buildAddGroupUserPolicyRequest({
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
    targetUser: createTestTrustedUserIdentity({
      userId: removedUserId,
      encapsulationPublicKey: removedUserKem.publicKey,
      encapsulationKeyFingerprint: await toFingerprint(
        removedUserKem.publicKey,
      ),
      signingKeyFingerprint: signingFingerprint,
      signingPublicKey: signingKeyPair.signingPublicKey,
    }),
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
  let boundHead: ReferencedPrincipalHead | null = null;
  let currentPolicy = previousPolicy;
  const remainingUserIdentity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(
      remainingUserKem.publicKey,
    ),
    encapsulationPublicKey: remainingUserKem.publicKey,
    signingKeyFingerprint: signingFingerprint,
    signingPublicKey: signingKeyPair.signingPublicKey,
    userId: signerUserId,
  });
  const removedUserIdentity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(removedUserKem.publicKey),
    encapsulationPublicKey: removedUserKem.publicKey,
    signingKeyFingerprint: signingFingerprint,
    signingPublicKey: signingKeyPair.signingPublicKey,
    userId: removedUserId,
  });
  const resolveTrustedUserIdentity = async (userId: string) => {
    if (userId === signerUserId) {
      return remainingUserIdentity;
    }
    if (userId === removedUserId) {
      return removedUserIdentity;
    }
    return null;
  };
  const apiClient: Parameters<
    typeof removeOrganizationGroupUser
  >[0]["apiClient"] = {
    createOrganizationGroup: async () => {
      throw new Error("Unexpected group create");
    },
    getCurrentPrincipalPolicy: async (principalType, principalId) => {
      if (principalType === "organization") {
        expect(principalId).toBe(organizationId);
        return organizationPolicy;
      }
      if (principalId === adminGroupId) {
        return adminPolicy;
      }
      expect(principalId).toBe(groupId);
      policyReadCount += 1;
      calls.push(policyReadCount === 1 ? "read-previous" : "read-current");
      return currentPolicy;
    },
    putPrincipalPolicy: async (principalType, principalId, input) => {
      expect(principalType).toBe("group");
      expect(principalId).toBe(groupId);
      calls.push("put-policy");
      const previousPolicy = currentPolicy;
      currentPolicy = await policyBundleAfterMutation({
        mutation: input,
        previous: previousPolicy,
      });
      return currentPolicy;
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
          "prepare-containers",
          "put-policy",
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
        const checkpointDuringBridge = await loadPrincipalPolicyCheckpoint(
          execSql,
          "group",
          groupId,
        );
        expect(checkpointDuringBridge).toEqual({
          principalType: "group",
          principalId: groupId,
          version: currentPolicy.currentState.version,
          stateHash: currentPolicy.currentState.stateHash,
        });
        expect(
          (await loadAllPrincipalPolicyBundles(execSql)).map(
            (bundle) => bundle.currentState.stateHash,
          ),
        ).toEqual(
          expect.arrayContaining([
            previousPolicy.currentState.stateHash,
            currentPolicy.currentState.stateHash,
          ]),
        );
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
      execSql,
      groupId,
      organizationId,
      prepareContainerMutations: async ({ nextPolicy }) => {
        calls.push("prepare-containers");
        if (!boundHead) {
          throw new Error("Expected the policy head before container planning");
        }
        expect(nextPolicy.stateHash).toBe(boundHead.stateHash);
        expect(nextPolicy.keyEpoch).toBe(
          previousPolicy.currentState.keyEpoch + 1,
        );
        expect(calls).toEqual([
          "read-previous",
          "bind-head",
          "prepare-containers",
        ]);
        return [];
      },
      removedUserId,
      resolveTrustedUserIdentity,
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    });

    expect(calls).toEqual([
      "read-previous",
      "bind-head",
      "prepare-containers",
      "put-policy",
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
            targetUser: createTestTrustedUserIdentity({
              userId: concurrentUserId,
              encapsulationPublicKey: concurrentUserKem.publicKey,
              encapsulationKeyFingerprint: await toFingerprint(
                concurrentUserKem.publicKey,
              ),
              signingKeyFingerprint: signingFingerprint,
              signingPublicKey: signingKeyPair.signingPublicKey,
            }),
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
        currentUserSecretKey: remainingUserKem.secretKey,
        execSql,
        groupId,
        organizationId,
        resolveTrustedUserIdentity,
        signerUserId,
        signingFingerprint,
        signingKeyPair,
        targetUserId: removedUserId,
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

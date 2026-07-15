import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  KeyingVerificationError,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
} from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import type { TrustedUserIdentity } from "../../data/trustedUserIdentity";
import {
  addOrganizationGroupUser,
  buildAddGroupUserPolicyRequest,
  buildInitialGroupPolicyRequest,
  removeOrganizationGroupUser,
} from "./principalPolicy";

interface GroupPolicyFixture {
  readonly creatorKem: ReturnType<typeof generateKemSeedAndKeyPair>;
  readonly groupId: string;
  readonly initialPolicy: PrincipalPolicyBundleResponse;
  readonly signerIdentity: TrustedUserIdentity;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: ReturnType<typeof generateSigningSeedAndKeyPair>;
}

async function createGroupPolicyFixture(): Promise<GroupPolicyFixture> {
  const creatorKem = generateKemSeedAndKeyPair();
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const initialRequest = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: creatorKem,
    groupId,
    name: "Operators",
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });

  return {
    creatorKem,
    groupId,
    initialPolicy: await policyBundleFromInitialRequest(initialRequest),
    signerIdentity: createTestTrustedUserIdentity({
      encapsulationKeyFingerprint: await toFingerprint(creatorKem.publicKey),
      encapsulationPublicKey: creatorKem.publicKey,
      signingKeyFingerprint: signingFingerprint,
      signingPublicKey: signingKeyPair.signingPublicKey,
      userId: signerUserId,
    }),
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  };
}

async function appendGroupMember(input: {
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly currentUsers: readonly TrustedUserIdentity[];
  readonly fixture: GroupPolicyFixture;
  readonly targetUser: TrustedUserIdentity;
}): Promise<PrincipalPolicyBundleResponse> {
  const mutation = await buildAddGroupUserPolicyRequest({
    canAdministerOrganization: false,
    currentPolicy: input.currentPolicy,
    currentPolicySignerPublicKeys: [
      {
        signingKeyFingerprint: input.fixture.signingFingerprint,
        signingPublicKey: input.fixture.signingKeyPair.signingPublicKey,
        userId: input.fixture.signerUserId,
      },
    ],
    currentUsers: input.currentUsers,
    currentUserSecretKey: input.fixture.creatorKem.secretKey,
    localPolicyCheckpoint: null,
    signerUserId: input.fixture.signerUserId,
    signingFingerprint: input.fixture.signingFingerprint,
    signingKeyPair: input.fixture.signingKeyPair,
    targetUser: input.targetUser,
  });

  return policyBundleAfterMutation({ mutation, previous: input.currentPolicy });
}

function createMutationApi(currentPolicy: PrincipalPolicyBundleResponse) {
  const calls = { putPolicy: 0 };
  const apiClient: Parameters<typeof addOrganizationGroupUser>[0]["apiClient"] =
    {
      createOrganizationGroup: async () => {
        throw new Error("Unexpected group creation");
      },
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        expect(principalType).toBe("group");
        expect(principalId).toBe(currentPolicy.currentState.principalId);
        return currentPolicy;
      },
      putPrincipalPolicy: async () => {
        calls.putPolicy += 1;
        throw new Error("Unexpected principal policy mutation");
      },
    };

  return { apiClient, calls };
}

test("group add propagates target identity equivocation before wrapping or mutation", async () => {
  const fixture = await createGroupPolicyFixture();
  const targetUserId = crypto.randomUUID();
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "Trusted target identity changed",
  );
  const { apiClient, calls } = createMutationApi(fixture.initialPolicy);
  const resolvedUserIds: string[] = [];
  let policyRequestBuilt = 0;
  const { close, execSql } = await createTestExecSql(
    "organization-add-target-identity-equivocation",
  );

  try {
    await expect(
      addOrganizationGroupUser({
        afterPolicyCommitBeforeCache: async () => {
          throw new Error("Unexpected policy commit bridge");
        },
        apiClient,
        beforePolicyCommit: () => {
          policyRequestBuilt += 1;
        },
        canAdministerOrganization: false,
        currentUserSecretKey: fixture.creatorKem.secretKey,
        execSql,
        groupId: fixture.groupId,
        resolveTrustedUserIdentity: async (userId) => {
          resolvedUserIds.push(userId);
          if (userId === targetUserId) {
            throw integrityError;
          }
          return userId === fixture.signerUserId
            ? fixture.signerIdentity
            : null;
        },
        signerUserId: fixture.signerUserId,
        signingFingerprint: fixture.signingFingerprint,
        signingKeyPair: fixture.signingKeyPair,
        targetUserId,
      }),
    ).rejects.toBe(integrityError);
  } finally {
    close();
  }

  expect(resolvedUserIds).toContain(targetUserId);
  expect(policyRequestBuilt).toBe(0);
  expect(calls).toEqual({ putPolicy: 0 });
});

test("group removal propagates remaining identity equivocation before rekey or mutation", async () => {
  const fixture = await createGroupPolicyFixture();
  const removedKem = generateKemSeedAndKeyPair();
  const remainingKem = generateKemSeedAndKeyPair();
  const removedUserId = crypto.randomUUID();
  const remainingUserId = crypto.randomUUID();
  const removedIdentity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(removedKem.publicKey),
    encapsulationPublicKey: removedKem.publicKey,
    signingKeyFingerprint: fixture.signingFingerprint,
    signingPublicKey: fixture.signingKeyPair.signingPublicKey,
    userId: removedUserId,
  });
  const remainingIdentity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(remainingKem.publicKey),
    encapsulationPublicKey: remainingKem.publicKey,
    signingKeyFingerprint: fixture.signingFingerprint,
    signingPublicKey: fixture.signingKeyPair.signingPublicKey,
    userId: remainingUserId,
  });
  const policyWithRemovedUser = await appendGroupMember({
    currentPolicy: fixture.initialPolicy,
    currentUsers: [fixture.signerIdentity],
    fixture,
    targetUser: removedIdentity,
  });
  const currentPolicy = await appendGroupMember({
    currentPolicy: policyWithRemovedUser,
    currentUsers: [fixture.signerIdentity, removedIdentity],
    fixture,
    targetUser: remainingIdentity,
  });
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "Trusted remaining identity changed",
  );
  const { apiClient, calls } = createMutationApi(currentPolicy);
  const resolvedUserIds: string[] = [];
  let policyRequestBuilt = 0;
  const { close, execSql } = await createTestExecSql(
    "organization-remove-remaining-identity-equivocation",
  );

  try {
    await expect(
      removeOrganizationGroupUser({
        afterPolicyCommitBeforeCache: async () => {
          throw new Error("Unexpected policy commit bridge");
        },
        apiClient,
        beforePolicyCommit: () => {
          policyRequestBuilt += 1;
        },
        canAdministerOrganization: false,
        execSql,
        groupId: fixture.groupId,
        organizationId: crypto.randomUUID(),
        removedUserId,
        resolveTrustedUserIdentity: async (userId) => {
          resolvedUserIds.push(userId);
          if (userId === remainingUserId) {
            throw integrityError;
          }
          return userId === fixture.signerUserId
            ? fixture.signerIdentity
            : null;
        },
        signerUserId: fixture.signerUserId,
        signingFingerprint: fixture.signingFingerprint,
        signingKeyPair: fixture.signingKeyPair,
      }),
    ).rejects.toBe(integrityError);
  } finally {
    close();
  }

  expect(resolvedUserIds).toContain(remainingUserId);
  expect(policyRequestBuilt).toBe(0);
  expect(calls).toEqual({ putPolicy: 0 });
});

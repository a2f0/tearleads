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
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import type { TrustedUserIdentity } from "../../data/trustedUserIdentity";
import { buildInitialOrganizationPolicyRequest } from "../registration/registerIdentity";
import { assertGroupMembershipName } from "./groupMembershipName";
import { buildAddGroupUserPolicyRequest } from "./groupPolicyRequests";
import {
  addOrganizationGroupUser,
  buildInitialGroupPolicyRequest,
  removeOrganizationGroupUser,
} from "./principalPolicy";

interface GroupPolicyFixture {
  readonly adminGroupId: string;
  readonly adminPolicy: PrincipalPolicyBundleResponse;
  readonly creatorKem: ReturnType<typeof generateKemSeedAndKeyPair>;
  readonly groupId: string;
  readonly initialPolicy: PrincipalPolicyBundleResponse;
  readonly memberGroupId: string;
  readonly organizationId: string;
  readonly organizationPolicy: PrincipalPolicyBundleResponse;
  readonly signerIdentity: TrustedUserIdentity;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: ReturnType<typeof generateSigningSeedAndKeyPair>;
}

test("membership name binding treats an unnamed payload as a flag-day reset, not an incident", async () => {
  const { initialPolicy } = await createGroupPolicyFixture();
  const unnamed = {
    ...initialPolicy,
    currentPayload: {
      ...initialPolicy.currentPayload,
      ciphertext: Buffer.from(JSON.stringify({ members: [] })).toString(
        "base64",
      ),
    },
  };
  const check = () => assertGroupMembershipName(unnamed, "Operators");
  expect(check).toThrow("must be reprovisioned");
  try {
    check();
  } catch (error) {
    expect(error).not.toBeInstanceOf(KeyingVerificationError);
  }
});

async function createGroupPolicyFixture(): Promise<GroupPolicyFixture> {
  const creatorKem = generateKemSeedAndKeyPair();
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const adminGroupId = crypto.randomUUID();
  const memberGroupId = crypto.randomUUID();
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
      groupHeads: [
        principalPolicyHead(adminPolicy),
        principalPolicyHead(adminPolicy, memberGroupId),
        principalPolicyHead(
          await policyBundleFromInitialRequest(initialRequest),
        ),
      ],
      memberGroupId,
      organizationId,
      signingKeyPair,
      userId: signerUserId,
    }),
  );

  return {
    adminGroupId,
    adminPolicy,
    creatorKem,
    groupId,
    initialPolicy: await policyBundleFromInitialRequest(initialRequest),
    memberGroupId,
    organizationId,
    organizationPolicy,
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

async function createMutationApi(
  fixture: GroupPolicyFixture,
  currentPolicy: PrincipalPolicyBundleResponse,
) {
  const calls = { commitPolicy: 0 };
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    fixture.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: fixture.adminGroupId,
      encapsulationPublicKey: fixture.creatorKem.publicKey,
      groupHeads: [
        principalPolicyHead(fixture.adminPolicy),
        principalPolicyHead(fixture.adminPolicy, fixture.memberGroupId),
        principalPolicyHead(currentPolicy),
      ],
      memberGroupId: fixture.memberGroupId,
      organizationId: fixture.organizationId,
      signingKeyPair: fixture.signingKeyPair,
      userId: fixture.signerUserId,
    }),
  );
  const apiClient: Parameters<typeof addOrganizationGroupUser>[0]["apiClient"] =
    {
      commitOrganizationGroupPolicy: async () => {
        calls.commitPolicy += 1;
        throw new Error("Unexpected group policy commit");
      },
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        if (principalType === "organization") {
          expect(principalId).toBe(fixture.organizationId);
          return organizationPolicy;
        }
        expect(principalType).toBe("group");
        if (principalId === fixture.adminGroupId) {
          return fixture.adminPolicy;
        }
        expect(principalId).toBe(currentPolicy.currentState.principalId);
        return currentPolicy;
      },
    };

  return { apiClient, calls };
}

test.each([
  "Operators",
  " ｏｐｅｒａｔｏｒｓ ",
])("group add accepts matching label %j before checking recipient identity", async (expectedGroupName) => {
  const fixture = await createGroupPolicyFixture();
  const targetUserId = crypto.randomUUID();
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "Trusted target identity changed",
  );
  const { apiClient, calls } = await createMutationApi(
    fixture,
    fixture.initialPolicy,
  );
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
        currentUserSecretKey: fixture.creatorKem.secretKey,
        execSql,
        groupId: fixture.groupId,
        organizationId: fixture.organizationId,
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
        expectedGroupName,
      }),
    ).rejects.toBe(integrityError);
  } finally {
    close();
  }

  expect(resolvedUserIds).toContain(targetUserId);
  expect(policyRequestBuilt).toBe(0);
  expect(calls).toEqual({ commitPolicy: 0 });
});

test.each([
  "Executives",
  "Operators\u200b",
  "Operators\u202e",
  "",
])("group add refuses a relabeled selection %j before resolving the recipient", async (expectedGroupName) => {
  const fixture = await createGroupPolicyFixture();
  const { apiClient, calls } = await createMutationApi(
    fixture,
    fixture.initialPolicy,
  );
  const targetUserId = crypto.randomUUID();
  const resolvedUserIds: string[] = [];
  let prepared = false;
  const { close, execSql } = await createTestExecSql("group-add-name-binding");
  try {
    await expect(
      addOrganizationGroupUser({
        apiClient,
        beforePolicyCommit: () => {
          prepared = true;
        },
        currentUserSecretKey: fixture.creatorKem.secretKey,
        execSql,
        expectedGroupName,
        groupId: fixture.groupId,
        organizationId: fixture.organizationId,
        resolveTrustedUserIdentity: async (userId) => {
          resolvedUserIds.push(userId);
          return userId === fixture.signerUserId
            ? fixture.signerIdentity
            : null;
        },
        signerUserId: fixture.signerUserId,
        signingFingerprint: fixture.signingFingerprint,
        signingKeyPair: fixture.signingKeyPair,
        targetUserId,
      }),
    ).rejects.toMatchObject({
      code: "object_mismatch",
      name: "GroupMembershipNameMismatchError",
    });
    expect(resolvedUserIds).not.toContain(targetUserId);
    expect(prepared).toBe(false);
    expect(calls.commitPolicy).toBe(0);
  } finally {
    close();
  }
});

test("group removal refuses a relabeled selection before committing", async () => {
  const fixture = await createGroupPolicyFixture();
  const { apiClient, calls } = await createMutationApi(
    fixture,
    fixture.initialPolicy,
  );
  const { close, execSql } = await createTestExecSql(
    "group-remove-name-binding",
  );
  try {
    await expect(
      removeOrganizationGroupUser({
        apiClient,
        beforePolicyCommit: () => {
          throw new Error("Unexpected policy preparation");
        },
        execSql,
        expectedGroupName: "Executives",
        groupId: fixture.groupId,
        organizationId: fixture.organizationId,
        removedUserId: fixture.signerUserId,
        resolveTrustedUserIdentity: async (userId) =>
          userId === fixture.signerUserId ? fixture.signerIdentity : null,
        signerUserId: fixture.signerUserId,
        signingFingerprint: fixture.signingFingerprint,
        signingKeyPair: fixture.signingKeyPair,
      }),
    ).rejects.toMatchObject({
      code: "object_mismatch",
      name: "GroupMembershipNameMismatchError",
    });
    expect(calls.commitPolicy).toBe(0);
  } finally {
    close();
  }
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
  const { apiClient, calls } = await createMutationApi(fixture, currentPolicy);
  const resolvedUserIds: string[] = [];
  let policyRequestBuilt = 0;
  const { close, execSql } = await createTestExecSql(
    "organization-remove-remaining-identity-equivocation",
  );

  try {
    await expect(
      removeOrganizationGroupUser({
        expectedGroupName: "Operators",
        afterPolicyCommitBeforeCache: async () => {
          throw new Error("Unexpected policy commit bridge");
        },
        apiClient,
        beforePolicyCommit: () => {
          policyRequestBuilt += 1;
        },
        execSql,
        groupId: fixture.groupId,
        organizationId: fixture.organizationId,
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
  expect(calls).toEqual({ commitPolicy: 0 });
});

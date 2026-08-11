import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import type {
  AddOrganizationGroupUserInput,
  RemoveOrganizationGroupUserInput,
} from "../../client/organizations";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import { buildInitialOrganizationPolicyRequest } from "../registration/registerIdentity";
import {
  addOrganizationGroupUser,
  buildInitialGroupPolicyRequest,
  removeOrganizationGroupUser,
} from "./principalPolicy";

type OmitsProjectedAuthority<T> = "canAdministerOrganization" extends keyof T
  ? false
  : true;

const publicMutationInputsOmitProjectedAuthority: [
  OmitsProjectedAuthority<AddOrganizationGroupUserInput>,
  OmitsProjectedAuthority<RemoveOrganizationGroupUserInput>,
] = [true, true];

test("public group-user mutation inputs omit projected organization authority", () => {
  expect(publicMutationInputsOmitProjectedAuthority).toEqual([true, true]);
});

test("local admin projections cannot authorize a group membership mutation", async () => {
  const groupAdminKeys = generateSigningSeedAndKeyPair();
  const groupAdminKem = generateKemSeedAndKeyPair();
  const organizationAdminKeys = generateSigningSeedAndKeyPair();
  const organizationAdminKem = generateKemSeedAndKeyPair();
  const attemptedSignerKeys = generateSigningSeedAndKeyPair();
  const attemptedSignerKem = generateKemSeedAndKeyPair();
  const groupAdminUserId = crypto.randomUUID();
  const organizationAdminUserId = crypto.randomUUID();
  const attemptedSignerUserId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const adminGroupId = crypto.randomUUID();
  const memberGroupId = crypto.randomUUID();
  const groupAdminFingerprint = await toFingerprint(
    groupAdminKeys.signingPublicKey,
  );
  const attemptedSignerFingerprint = await toFingerprint(
    attemptedSignerKeys.signingPublicKey,
  );
  const groupPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: groupAdminKem,
      groupId,
      name: "Operators",
      signerUserId: groupAdminUserId,
      signingFingerprint: groupAdminFingerprint,
      signingKeyPair: groupAdminKeys,
    }),
  );
  const adminPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: organizationAdminKem,
      groupId: adminGroupId,
      name: "Admins",
      signerUserId: organizationAdminUserId,
      signingFingerprint: await toFingerprint(
        organizationAdminKeys.signingPublicKey,
      ),
      signingKeyPair: organizationAdminKeys,
    }),
  );
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId,
      encapsulationPublicKey: organizationAdminKem.publicKey,
      groupHeads: [
        principalPolicyHead(adminPolicy),
        principalPolicyHead(adminPolicy, memberGroupId),
        principalPolicyHead(groupPolicy),
      ],
      memberGroupId,
      organizationId,
      signingKeyPair: organizationAdminKeys,
      userId: organizationAdminUserId,
    }),
  );
  const identities = new Map<
    string,
    ReturnType<typeof createTestTrustedUserIdentity>
  >([
    [
      groupAdminUserId,
      createTestTrustedUserIdentity({
        encapsulationKeyFingerprint: await toFingerprint(
          groupAdminKem.publicKey,
        ),
        encapsulationPublicKey: groupAdminKem.publicKey,
        signingKeyFingerprint: groupAdminFingerprint,
        signingPublicKey: groupAdminKeys.signingPublicKey,
        userId: groupAdminUserId,
      }),
    ],
    [
      organizationAdminUserId,
      createTestTrustedUserIdentity({
        encapsulationKeyFingerprint: await toFingerprint(
          organizationAdminKem.publicKey,
        ),
        encapsulationPublicKey: organizationAdminKem.publicKey,
        signingKeyFingerprint: await toFingerprint(
          organizationAdminKeys.signingPublicKey,
        ),
        signingPublicKey: organizationAdminKeys.signingPublicKey,
        userId: organizationAdminUserId,
      }),
    ],
  ]);
  const calls = {
    adminPolicy: 0,
    beforeCommit: 0,
    organizationPolicy: 0,
    putPolicy: 0,
  };
  const { close, execSql } = await createTestExecSql(
    "organization-group-mutation-projected-admin-boundary",
  );

  try {
    await expect(
      addOrganizationGroupUser({
        apiClient: {
          createOrganizationGroup: async () => null,
          getCurrentPrincipalPolicy: async (principalType, principalId) => {
            if (principalType === "organization") {
              calls.organizationPolicy += 1;
              return organizationPolicy;
            }
            if (principalId === adminGroupId) {
              calls.adminPolicy += 1;
              return adminPolicy;
            }
            return groupPolicy;
          },
          putPrincipalPolicy: async () => {
            calls.putPolicy += 1;
            return null;
          },
        },
        beforePolicyCommit: () => {
          calls.beforeCommit += 1;
        },
        currentUserSecretKey: attemptedSignerKem.secretKey,
        execSql,
        groupId,
        organizationId,
        resolveTrustedUserIdentity: async (userId) =>
          identities.get(userId) ?? null,
        signerUserId: attemptedSignerUserId,
        signingFingerprint: attemptedSignerFingerprint,
        signingKeyPair: attemptedSignerKeys,
        targetUserId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("Organization admin authority is required");
    expect(calls).toEqual({
      adminPolicy: 1,
      beforeCommit: 0,
      organizationPolicy: 1,
      putPolicy: 0,
    });
    await expect(
      loadPrincipalPolicyCheckpoint(execSql, "organization", organizationId),
    ).resolves.toEqual({
      principalType: "organization",
      principalId: organizationId,
      version: organizationPolicy.currentState.version,
      stateHash: organizationPolicy.currentState.stateHash,
    });
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

test("a verified Admins member can mutate another group after the signed directory advances", async () => {
  const founderKeys = generateSigningSeedAndKeyPair();
  const founderKem = generateKemSeedAndKeyPair();
  const signerKeys = generateSigningSeedAndKeyPair();
  const signerKem = generateKemSeedAndKeyPair();
  const targetKeys = generateSigningSeedAndKeyPair();
  const targetKem = generateKemSeedAndKeyPair();
  const founderUserId = crypto.randomUUID();
  const signerUserId = crypto.randomUUID();
  const targetUserId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const adminGroupId = crypto.randomUUID();
  const memberGroupId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(signerKeys.signingPublicKey);
  const founderSigningFingerprint = await toFingerprint(
    founderKeys.signingPublicKey,
  );
  const founderIdentity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(founderKem.publicKey),
    encapsulationPublicKey: founderKem.publicKey,
    signingKeyFingerprint: founderSigningFingerprint,
    signingPublicKey: founderKeys.signingPublicKey,
    userId: founderUserId,
  });
  const signerIdentity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(signerKem.publicKey),
    encapsulationPublicKey: signerKem.publicKey,
    signingKeyFingerprint: signingFingerprint,
    signingPublicKey: signerKeys.signingPublicKey,
    userId: signerUserId,
  });
  const initialAdminPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: founderKem,
      groupId: adminGroupId,
      name: "Admins",
      signerUserId: founderUserId,
      signingFingerprint: founderSigningFingerprint,
      signingKeyPair: founderKeys,
    }),
  );
  const initialAdminHead = {
    principalType: "group" as const,
    principalId: initialAdminPolicy.currentState.principalId,
    version: initialAdminPolicy.currentState.version,
    keyEpoch: initialAdminPolicy.currentState.keyEpoch,
    stateHash: initialAdminPolicy.currentState.stateHash,
    keyFingerprint: initialAdminPolicy.currentState.keyFingerprint,
  };
  const initialGroupPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: founderKem,
      externalAuthority: initialAdminHead,
      groupId,
      includeSignerAsAdmin: false,
      name: "Operators",
      signerUserId: founderUserId,
      signingFingerprint: founderSigningFingerprint,
      signingKeyPair: founderKeys,
    }),
  );
  let currentOrganizationPolicy =
    await organizationPolicyBundleFromInitialRequest(
      organizationId,
      await buildInitialOrganizationPolicyRequest({
        adminGroupId,
        encapsulationPublicKey: founderKem.publicKey,
        groupHeads: [
          principalPolicyHead(initialAdminPolicy),
          principalPolicyHead(initialAdminPolicy, memberGroupId),
          principalPolicyHead(initialGroupPolicy),
        ],
        memberGroupId,
        organizationId,
        signingKeyPair: founderKeys,
        userId: founderUserId,
      }),
    );
  const identities = new Map<
    string,
    ReturnType<typeof createTestTrustedUserIdentity>
  >([
    [founderUserId, founderIdentity],
    [signerUserId, signerIdentity],
    [
      targetUserId,
      createTestTrustedUserIdentity({
        encapsulationKeyFingerprint: await toFingerprint(targetKem.publicKey),
        encapsulationPublicKey: targetKem.publicKey,
        signingKeyFingerprint: await toFingerprint(targetKeys.signingPublicKey),
        signingPublicKey: targetKeys.signingPublicKey,
        userId: targetUserId,
      }),
    ],
  ]);
  let currentAdminPolicy = initialAdminPolicy;
  let currentGroupPolicy = initialGroupPolicy;
  let adminPolicyReads = 0;
  let organizationPolicyReads = 0;
  let policyPutCount = 0;
  const { close, execSql } = await createTestExecSql(
    "organization-group-mutation-verified-admin-boundary",
  );

  try {
    const apiClient = {
      createOrganizationGroup: async () => null,
      getCurrentPrincipalPolicy: async (
        principalType: "group" | "organization",
        principalId: string,
      ) => {
        if (principalType === "organization") {
          organizationPolicyReads += 1;
          return currentOrganizationPolicy;
        }
        if (principalId === adminGroupId) {
          adminPolicyReads += 1;
          return { ...currentAdminPolicy, containerMutations: [] };
        }
        return { ...currentGroupPolicy, containerMutations: [] };
      },
      commitOrganizationGroupPolicy: async (
        _organizationId: string,
        principalId: string,
        mutation: Parameters<
          NonNullable<
            Parameters<
              typeof addOrganizationGroupUser
            >[0]["apiClient"]["commitOrganizationGroupPolicy"]
          >
        >[2],
      ) => {
        policyPutCount += 1;
        if (principalId === adminGroupId) {
          currentAdminPolicy = await policyBundleAfterMutation({
            mutation: mutation.groupPolicy,
            previous: currentAdminPolicy,
          });
        } else {
          currentGroupPolicy = await policyBundleAfterMutation({
            mutation: mutation.groupPolicy,
            previous: currentGroupPolicy,
          });
        }
        currentOrganizationPolicy = await policyBundleAfterMutation({
          mutation: mutation.organizationPolicy,
          previous: currentOrganizationPolicy,
        });
        return {
          groupPolicy: {
            ...(principalId === adminGroupId
              ? currentAdminPolicy
              : currentGroupPolicy),
            containerMutations: [],
          },
          organizationPolicy: {
            ...currentOrganizationPolicy,
            containerMutations: [],
          },
        };
      },
      putPrincipalPolicy: async () => null,
    };
    await addOrganizationGroupUser({
      apiClient,
      beforePolicyCommit: () => {},
      currentUserSecretKey: founderKem.secretKey,
      execSql,
      groupId: adminGroupId,
      organizationId,
      resolveTrustedUserIdentity: async (userId) =>
        identities.get(userId) ?? null,
      signerUserId: founderUserId,
      signingFingerprint: founderSigningFingerprint,
      signingKeyPair: founderKeys,
      targetUserId: signerUserId,
    });

    const result = await addOrganizationGroupUser({
      apiClient,
      beforePolicyCommit: () => {},
      currentUserSecretKey: signerKem.secretKey,
      execSql,
      groupId,
      organizationId,
      resolveTrustedUserIdentity: async (userId) =>
        identities.get(userId) ?? null,
      signerUserId,
      signingFingerprint,
      signingKeyPair: signerKeys,
      targetUserId,
    });

    expect(result.currentProjection).toEqual([
      {
        userId: targetUserId,
        role: "member",
      },
    ]);
    // Production omits afterPolicyCommitBeforeCache entirely; the mutated
    // bundle must still land in the local cache without it.
    const cachedPolicy = await loadPrincipalPolicyBundle(
      execSql,
      "group",
      groupId,
    );
    expect(cachedPolicy?.currentState.stateHash).toBe(
      result.currentState.stateHash,
    );
    expect(currentOrganizationPolicy.currentProjection).toContainEqual({
      userId: signerUserId,
      role: "admin",
    });
    expect(currentAdminPolicy.currentProjection).toContainEqual({
      userId: signerUserId,
      role: "admin",
    });
    expect(adminPolicyReads).toBeGreaterThan(0);
    expect(organizationPolicyReads).toBeGreaterThan(0);

    const emptiedGroup = await removeOrganizationGroupUser({
      apiClient,
      beforePolicyCommit: () => {},
      execSql,
      groupId,
      organizationId,
      removedUserId: targetUserId,
      resolveTrustedUserIdentity: async (userId) =>
        identities.get(userId) ?? null,
      signerUserId,
      signingFingerprint,
      signingKeyPair: signerKeys,
    });
    expect(emptiedGroup.currentProjection).toEqual([]);

    await removeOrganizationGroupUser({
      apiClient,
      beforePolicyCommit: () => {},
      execSql,
      groupId: adminGroupId,
      organizationId,
      removedUserId: signerUserId,
      resolveTrustedUserIdentity: async (userId) =>
        identities.get(userId) ?? null,
      signerUserId: founderUserId,
      signingFingerprint: founderSigningFingerprint,
      signingKeyPair: founderKeys,
    });
    const committedPutCount = policyPutCount;

    await expect(
      addOrganizationGroupUser({
        apiClient,
        beforePolicyCommit: () => {},
        currentUserSecretKey: signerKem.secretKey,
        execSql,
        groupId,
        organizationId,
        resolveTrustedUserIdentity: async (userId) =>
          identities.get(userId) ?? null,
        signerUserId,
        signingFingerprint,
        signingKeyPair: signerKeys,
        targetUserId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("Organization admin authority is required");
    expect(policyPutCount).toBe(committedPutCount);
  } finally {
    close();
  }
});

import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { buildInitialGroupPolicyRequest } from "../../../../test/helpers/groupMetadata";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundle } from "../../../data/persistence/principalPolicy/principalPolicyPersistence";
import { buildInitialOrganizationPolicyRequest } from "../../registration/registerIdentity";
import { shareRemoteContainerWithGroup } from "./shareWithGroup";

test("a group share does not acknowledge a policy after its generation expires during commit", async () => {
  const parent = await createParentProjection();
  const author = parent.author;
  const signingKeyPair = {
    signingPrivateKey: author.signerPrivateKey,
    signingPublicKey: parent.signingPublicKey,
  };
  const groupId = "generation-race-group";
  const memberGroupId = "generation-race-members";
  const initialGroupPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
      groupId,
      name: "Admins",
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair,
    }),
  );
  let groupPolicy = initialGroupPolicy;
  let organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    parent.projection.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: groupId,
      encapsulationPublicKey: parent.encapsulationPublicKey,
      groupHeads: [
        principalPolicyHead(groupPolicy),
        principalPolicyHead(groupPolicy, memberGroupId),
      ],
      memberGroupId,
      organizationId: parent.projection.organizationId,
      signingKeyPair,
      userId: author.signerUserId,
    }),
  );
  const database = await createTestExecSql("group-share-commit-generation");
  let current = true;
  let submissions = 0;

  try {
    const shared = await shareRemoteContainerWithGroup({
      reportSecurityIncident: async () => {},
      accessLevel: "read",
      apiClient: {
        reciteContainer: async () => null,
        evictContainerWriterProjection: () => {},
        commitOrganizationGroupPolicy: async (
          _organizationId,
          _groupId,
          mutation,
        ) => {
          submissions += 1;
          groupPolicy = await policyBundleAfterMutation({
            mutation: mutation.groupPolicy,
            previous: groupPolicy,
          });
          organizationPolicy = await policyBundleAfterMutation({
            mutation: mutation.organizationPolicy,
            previous: organizationPolicy,
          });
          const containerMutations = await Promise.all(
            (mutation.groupPolicy.containerMutations ?? []).map((request) =>
              createMutationResponseFromRequest(request),
            ),
          );
          current = false;
          return {
            groupPolicy: { ...groupPolicy, containerMutations },
            organizationPolicy: {
              ...organizationPolicy,
              containerMutations: [],
            },
          };
        },
        getContainerWriterProjectionResult: async () => ({
          ok: true,
          data: parent.projection,
        }),
        getContainerWriterProjection: async () => parent.projection,
        getCurrentPrincipalPolicy: async (principalType, principalId) => {
          if (principalType === "organization") return organizationPolicy;
          expect(principalId).toBe(groupId);
          return groupPolicy;
        },
        shareContainer: async () => {
          throw new Error("Compound group share must use the policy PUT");
        },
      },
      author,
      containerId: parent.projection.containerId,
      execSql: database.execSql,
      expectedGroupName: "Admins",
      recipientGroupId: groupId,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: async (userId) =>
        createTestTrustedUserIdentity({
          encapsulationPublicKey: parent.encapsulationPublicKey,
          signingKeyFingerprint: author.signerKeyFingerprint,
          signingPublicKey: parent.signingPublicKey,
          userId,
        }),
      signingKeyPair,
      stillCurrent: () => current,
      targetSecretKey: parent.secretKey,
    });

    expect(shared).toBeNull();
    expect(submissions).toBe(1);
    expect(
      await loadPrincipalPolicyCheckpoint(database.execSql, "group", groupId),
    ).toMatchObject({
      stateHash: initialGroupPolicy.currentState.stateHash,
      version: initialGroupPolicy.currentState.version,
    });
    expect(
      (await loadPrincipalPolicyBundle(database.execSql, "group", groupId))
        ?.currentState.stateHash,
    ).toBe(initialGroupPolicy.currentState.stateHash);
  } finally {
    database.close();
  }
});

test("a missing group grant returns null when projection verification expires", async () => {
  const parent = await createParentProjection();
  const author = parent.author;
  const signingKeyPair = {
    signingPrivateKey: author.signerPrivateKey,
    signingPublicKey: parent.signingPublicKey,
  };
  const groupId = "expired-preparation-group";
  const memberGroupId = "expired-preparation-members";
  const groupPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
      groupId,
      name: "Admins",
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair,
    }),
  );
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    parent.projection.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: groupId,
      encapsulationPublicKey: parent.encapsulationPublicKey,
      groupHeads: [
        principalPolicyHead(groupPolicy),
        principalPolicyHead(groupPolicy, memberGroupId),
      ],
      memberGroupId,
      organizationId: parent.projection.organizationId,
      signingKeyPair,
      userId: author.signerUserId,
    }),
  );
  const database = await createTestExecSql(
    "group-share-preparation-generation",
  );
  const resolveProjectionUserKey =
    createParentProjectionUserKeyResolver(parent);
  let current = true;
  let projectionRequests = 0;
  let submissions = 0;

  try {
    const shared = await shareRemoteContainerWithGroup({
      reportSecurityIncident: async () => {},
      accessLevel: "read",
      apiClient: {
        reciteContainer: async () => null,
        evictContainerWriterProjection: () => {},
        commitOrganizationGroupPolicy: async () => {
          submissions += 1;
          throw new Error("Expired preparation must not be committed");
        },
        getContainerWriterProjectionResult: async () => {
          projectionRequests += 1;
          return { ok: true, data: parent.projection };
        },
        getContainerWriterProjection: async () => {
          projectionRequests += 1;
          return parent.projection;
        },
        getCurrentPrincipalPolicy: async (principalType, principalId) => {
          if (principalType === "organization") return organizationPolicy;
          expect(principalId).toBe(groupId);
          return groupPolicy;
        },
        shareContainer: async () => {
          throw new Error("Compound group share must use the policy PUT");
        },
      },
      author,
      containerId: parent.projection.containerId,
      execSql: database.execSql,
      expectedGroupName: "Admins",
      recipientGroupId: groupId,
      resolveProjectionUserKey,
      resolveTrustedUserIdentity: async (userId) => {
        const identity = createTestTrustedUserIdentity({
          encapsulationPublicKey: parent.encapsulationPublicKey,
          signingKeyFingerprint: author.signerKeyFingerprint,
          signingPublicKey: parent.signingPublicKey,
          userId,
        });
        if (projectionRequests > 1) current = false;
        return identity;
      },
      signingKeyPair,
      stillCurrent: () => current,
      targetSecretKey: parent.secretKey,
    });

    expect(shared).toBeNull();
    expect(current).toBe(false);
    expect(submissions).toBe(0);
  } finally {
    database.close();
  }
});

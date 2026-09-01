import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
} from "../../../../test/helpers/containerFixtures";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundle } from "../../../data/persistence/principalPolicyPersistence";
import { buildInitialGroupPolicyRequest } from "../../organizations/principalPolicy";
import { buildInitialOrganizationPolicyRequest } from "../../registration/registerIdentity";
import { shareRemoteContainer, shareRemoteContainerWithGroup } from "./share";

test("shareRemoteContainer does not submit after its generation expires during planning", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const database = await createTestExecSql("container-share-generation");
  let current = true;
  let shareCallCount = 0;

  try {
    const shared = await shareRemoteContainer({
      accessLevel: "write",
      apiClient: {
        getContainerWriterProjection: async () => {
          current = false;
          return parent.projection;
        },
        shareContainer: async () => {
          shareCallCount += 1;
          throw new Error("A stale share must not be submitted");
        },
      },
      author,
      containerId: parent.projection.containerId,
      execSql: database.execSql,
      recipientUserId: "user-2",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: createRecipientIdentityResolver({
        encapsulationPublicKey: recipientKeyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey: parent.signingPublicKey,
      }),
      stillCurrent: () => current,
      targetSecretKey: parent.secretKey,
    });

    expect(shared).toBeNull();
    expect(shareCallCount).toBe(0);
  } finally {
    database.close();
  }
});

test("shareRemoteContainer does not return an unacknowledged committed response", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const database = await createTestExecSql("container-share-submit-generation");
  let current = true;

  try {
    const shared = await shareRemoteContainer({
      accessLevel: "write",
      apiClient: {
        getContainerWriterProjection: async () => parent.projection,
        shareContainer: async (_containerId, request) => {
          const response = await createMutationResponseFromRequest(request);
          current = false;
          return response;
        },
      },
      author,
      containerId: parent.projection.containerId,
      execSql: database.execSql,
      recipientUserId: "user-2",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: createRecipientIdentityResolver({
        encapsulationPublicKey: recipientKeyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey: parent.signingPublicKey,
      }),
      stillCurrent: () => current,
      targetSecretKey: parent.secretKey,
    });

    expect(shared).toBeNull();
  } finally {
    database.close();
  }
});

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
      name: "Generation race group",
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
      accessLevel: "read",
      apiClient: {
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

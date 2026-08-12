import { expect, test } from "bun:test";
import {
  type ContainerGrantAccessEventBody,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type KeyingCanonicalJson,
  toFingerprint,
  type VerifiedContainerAccessManifest,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
  SIGNED_AT,
  tamperFirstProjectionEventSignature,
} from "../../../../test/helpers/containerFixtures";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { buildInitialGroupPolicyRequest } from "../../organizations/principalPolicy";
import { buildInitialOrganizationPolicyRequest } from "../../registration/registerIdentity";
import { shareRemoteContainer, shareRemoteContainerWithGroup } from "./share";

test("shareRemoteContainer rejects tampered projected container state before sending", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const database = await createTestExecSql("container-share-tampered-state");
  let shareCalled = false;
  await expect(
    shareRemoteContainer({
      accessLevel: "read",
      apiClient: {
        getContainerWriterProjection: async () => ({
          ...parent.projection,
          path: parent.projection.path.map((bundle) => ({
            ...bundle,
            state: {
              ...bundle.state,
              directGrants: "not-grants",
            },
          })),
        }),
        shareContainer: async () => {
          shareCalled = true;
          throw new Error("Unexpected share call");
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
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow("Container writer projection path[0] state mismatch");
  database.close();
  expect(shareCalled).toBe(false);
});

test("shareRemoteContainer rejects bad previous projection signatures before sending", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const tamperedProjection = tamperFirstProjectionEventSignature(
    parent.projection,
  );
  const database = await createTestExecSql(
    "container-share-tampered-signature",
  );
  let shareCalled = false;
  await expect(
    shareRemoteContainer({
      accessLevel: "read",
      apiClient: {
        getContainerWriterProjection: async () => tamperedProjection,
        shareContainer: async () => {
          shareCalled = true;
          throw new Error("Unexpected share call");
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
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow(
    "Container writer projection path[0] signature verification failed",
  );
  database.close();
  expect(shareCalled).toBe(false);
});

test("shareRemoteContainer includes existing direct user recipient keys", async () => {
  const parent = await createParentProjection();
  const { author, signingPublicKey } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const database = await createTestExecSql("container-share-user");
  const submittedRequests: ContainerMutationRequest[] = [];
  const shared = await shareRemoteContainer({
    accessLevel: "write",
    apiClient: {
      getContainerWriterProjection: async () => parent.projection,
      shareContainer: async (_containerId, request) => {
        submittedRequests.push(request);
        const response = await createMutationResponseFromRequest(request);
        return {
          ...response,
          containerKek: {
            ...response.containerKek,
            // Postgres returns wraps in recipient-key order, which need not
            // match the sender's semantically equivalent request order.
            wraps: [...response.containerKek.wraps].reverse(),
          },
        };
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
    signedAt: SIGNED_AT,
    targetSecretKey: parent.secretKey,
  });
  database.close();
  expect(shared).not.toBeNull();
  if (!shared) {
    throw new Error("Expected share result");
  }
  const submittedRequest = submittedRequests[0];
  if (!submittedRequest) {
    throw new Error("Expected submitted share request");
  }
  const submittedUserRecipientKeys =
    submittedRequest.userRecipientKeys as unknown as ContainerUserRecipientKey[];
  expect(submittedUserRecipientKeys.map((key) => key.userId)).toEqual([
    "user-1",
    "user-2",
  ]);
  const verifiedEvent = await verifySignedAccessEvent({
    body: shared.plan.body as unknown as KeyingCanonicalJson,
    event: shared.plan.event,
    signerPublicKey: signingPublicKey,
  });
  expect(verifiedEvent.ok).toBe(true);
  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }
  const previousManifest = parent.projection
    .path[0] as unknown as VerifiedContainerAccessManifest;
  const verifiedManifest = await verifyContainerAccessManifest({
    event: verifiedEvent.value,
    expectedManifestHash: shared.plan.manifestHash,
    manifest: shared.plan.manifest,
    previousManifest,
    previousContainerPath: [previousManifest],
  });
  expect(verifiedManifest.ok).toBe(true);
  if (!verifiedManifest.ok) {
    throw verifiedManifest.error;
  }

  const verifiedKek = await verifyContainerKekState({
    containerManifest: verifiedManifest.value,
    containerManifestHistory: [previousManifest],
    keyEpoch: shared.plan.keyEpoch,
    userRecipientKeys: submittedUserRecipientKeys,
    wraps: shared.plan.wraps,
  });
  expect(verifiedKek.ok).toBe(true);
  if (!verifiedKek.ok) {
    throw verifiedKek.error;
  }
  const ownerUserRecipientKey = submittedUserRecipientKeys[0];
  const peerUserRecipientKey = submittedUserRecipientKeys[1];
  if (!ownerUserRecipientKey || !peerUserRecipientKey) {
    throw new Error("Expected owner and peer recipient keys");
  }
  expect(verifiedKek.value.recipientTargets).toEqual([
    {
      recipientKind: "user",
      recipientId: "user-1",
      recipientKeyEpochId: ownerUserRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: ownerUserRecipientKey.recipientKeyFingerprint,
    },
    {
      recipientKind: "user",
      recipientId: "user-2",
      recipientKeyEpochId: peerUserRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: peerUserRecipientKey.recipientKeyFingerprint,
    },
  ]);
});

test("shareRemoteContainerWithGroup grants a managed principal with the selected access", async () => {
  const parent = await createParentProjection();
  const author = parent.author;
  const groupSigningKeyPair = {
    signingPrivateKey: author.signerPrivateKey,
    signingPublicKey: parent.signingPublicKey,
  };
  const groupEncapsulationKeyPair = generateKemSeedAndKeyPair();
  const groupSignerUserId = author.signerUserId;
  const groupId = "group-1";
  const groupSigningFingerprint = author.signerKeyFingerprint;
  const groupPolicyRequest = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: groupEncapsulationKeyPair,
    groupId,
    name: "Admins",
    signerUserId: groupSignerUserId,
    signingFingerprint: groupSigningFingerprint,
    signingKeyPair: groupSigningKeyPair,
  });
  let groupPolicy = await policyBundleFromInitialRequest(groupPolicyRequest);
  let organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    parent.projection.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: groupId,
      encapsulationPublicKey: parent.encapsulationPublicKey,
      groupHeads: [
        principalPolicyHead(groupPolicy),
        principalPolicyHead(groupPolicy, "members-group"),
      ],
      memberGroupId: "members-group",
      organizationId: parent.projection.organizationId,
      signingKeyPair: groupSigningKeyPair,
      userId: groupSignerUserId,
    }),
  );
  const submittedRequests: ContainerMutationRequest[] = [];

  const shared = await withTestExecSql("container-group-share", (execSql) =>
    shareRemoteContainerWithGroup({
      accessLevel: "read",
      apiClient: {
        commitOrganizationGroupPolicy: async (
          _organizationId,
          _groupId,
          mutation,
        ) => {
          submittedRequests.push(
            ...(mutation.groupPolicy.containerMutations ?? []),
          );
          groupPolicy = await policyBundleAfterMutation({
            mutation: mutation.groupPolicy,
            previous: groupPolicy,
          });
          organizationPolicy = await policyBundleAfterMutation({
            mutation: mutation.organizationPolicy,
            previous: organizationPolicy,
          });
          return {
            groupPolicy: {
              ...groupPolicy,
              containerMutations: await Promise.all(
                submittedRequests.map((request) =>
                  createMutationResponseFromRequest(request),
                ),
              ),
            },
            organizationPolicy: {
              ...organizationPolicy,
              containerMutations: [],
            },
          };
        },
        getContainerWriterProjection: async () => parent.projection,
        getCurrentPrincipalPolicy: async (principalType, principalId) => {
          if (principalType === "organization") {
            return organizationPolicy;
          }
          expect(principalType).toBe("group");
          expect(principalId).toBe(groupId);
          return groupPolicy;
        },
        shareContainer: async () => {
          throw new Error("Compound group share must use the policy PUT");
        },
      },
      author,
      containerId: parent.projection.containerId,
      execSql,
      recipientGroupId: groupId,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: async (userId) => {
        expect(userId).toBe(groupSignerUserId);
        return createTestTrustedUserIdentity({
          encapsulationPublicKey: parent.encapsulationPublicKey,
          signingKeyFingerprint: groupSigningFingerprint,
          signingPublicKey: groupSigningKeyPair.signingPublicKey,
          userId,
        });
      },
      signedAt: SIGNED_AT,
      signingKeyPair: groupSigningKeyPair,
      targetSecretKey: parent.secretKey,
    }),
  );

  expect(shared).not.toBeNull();
  const submittedRequest = submittedRequests[0];
  if (!submittedRequest) {
    throw new Error("Expected submitted share request");
  }

  const body =
    submittedRequest.body as unknown as ContainerGrantAccessEventBody;
  expect(body.grant).toEqual({
    accessLevel: "read",
    subjectId: groupId,
    subjectType: "group",
  });
  expect(body.referencedPrincipalHead).toEqual({
    principalType: "group",
    principalId: groupId,
    version: groupPolicy.currentState.version,
    keyEpoch: groupPolicy.currentState.keyEpoch,
    stateHash: groupPolicy.currentState.stateHash,
    keyFingerprint: groupPolicy.currentState.keyFingerprint,
  });
  expect(
    (submittedRequest.principalPolicies as Record<string, unknown>[]).map(
      (policy) => (policy as { principalId: unknown }).principalId,
    ),
  ).toEqual([groupId]);
  expect(
    (submittedRequest.wraps as unknown as ContainerKeyWrap[]).some(
      (wrap) => wrap.recipientKind === "group" && wrap.recipientId === groupId,
    ),
  ).toBe(true);
  expect(
    (
      submittedRequest.userRecipientKeys as unknown as ContainerUserRecipientKey[]
    ).map((key) => key.userId),
  ).toEqual([parent.userId]);
});

test("shareRemoteContainerWithGroup accepts empty groups signed by an org admin", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const groupSigningKeyPair = generateSigningSeedAndKeyPair();
  const groupEncapsulationKeyPair = generateKemSeedAndKeyPair();
  const groupSignerUserId = "org-admin-signer";
  const groupId = "group-empty";
  const adminGroupId = "admins-group";
  const groupSigningFingerprint = await toFingerprint(
    groupSigningKeyPair.signingPublicKey,
  );
  const adminPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: groupEncapsulationKeyPair,
      groupId: adminGroupId,
      name: "Admins",
      signerUserId: groupSignerUserId,
      signingFingerprint: groupSigningFingerprint,
      signingKeyPair: groupSigningKeyPair,
    }),
  );
  const groupPolicyRequest = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: groupEncapsulationKeyPair,
    externalAuthority: {
      principalType: "group",
      principalId: adminPolicy.currentState.principalId,
      version: adminPolicy.currentState.version,
      keyEpoch: adminPolicy.currentState.keyEpoch,
      stateHash: adminPolicy.currentState.stateHash,
      keyFingerprint: adminPolicy.currentState.keyFingerprint,
    },
    groupId,
    grants: [
      {
        accessLevel: "read",
        containerId: parent.projection.containerId,
      },
    ],
    includeSignerAsAdmin: false,
    name: "Operators",
    signerUserId: groupSignerUserId,
    signingFingerprint: groupSigningFingerprint,
    signingKeyPair: groupSigningKeyPair,
  });
  const groupPolicy = await policyBundleFromInitialRequest(groupPolicyRequest);
  const organizationPolicyRequest = await buildInitialOrganizationPolicyRequest(
    {
      adminGroupId,
      encapsulationPublicKey: groupEncapsulationKeyPair.publicKey,
      groupHeads: [
        principalPolicyHead(adminPolicy),
        principalPolicyHead(adminPolicy, "members-group"),
        principalPolicyHead(groupPolicy),
      ],
      memberGroupId: "members-group",
      organizationId: parent.projection.organizationId,
      signingKeyPair: groupSigningKeyPair,
      userId: groupSignerUserId,
    },
  );
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    parent.projection.organizationId,
    organizationPolicyRequest,
  );
  const submittedRequests: ContainerMutationRequest[] = [];

  const shared = await withTestExecSql(
    "container-empty-group-share",
    (execSql) =>
      shareRemoteContainerWithGroup({
        accessLevel: "read",
        apiClient: {
          commitOrganizationGroupPolicy: async () => null,
          getContainerWriterProjection: async () => parent.projection,
          getCurrentPrincipalPolicy: async (principalType, principalId) => {
            if (principalType === "organization") {
              expect(principalId).toBe(parent.projection.organizationId);
              return organizationPolicy;
            }

            if (principalId === adminGroupId) {
              return adminPolicy;
            }
            expect(principalId).toBe(groupId);
            return groupPolicy;
          },
          shareContainer: async (_containerId, request) => {
            submittedRequests.push(request);
            return createMutationResponseFromRequest(request);
          },
        },
        author,
        containerId: parent.projection.containerId,
        execSql,
        recipientGroupId: groupId,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        resolveTrustedUserIdentity: async (userId) => {
          expect(userId).toBe(groupSignerUserId);
          return createTestTrustedUserIdentity({
            encapsulationPublicKey: groupEncapsulationKeyPair.publicKey,
            signingKeyFingerprint: groupSigningFingerprint,
            signingPublicKey: groupSigningKeyPair.signingPublicKey,
            userId,
          });
        },
        signedAt: SIGNED_AT,
        targetSecretKey: parent.secretKey,
      }),
  );

  expect(shared).not.toBeNull();
  expect(groupPolicy.currentProjection).toEqual([]);
  expect(
    (submittedRequests[0]?.principalPolicies as Record<string, unknown>[]).map(
      (policy) => (policy as { principalId: unknown }).principalId,
    ),
  ).toEqual([groupId]);
});

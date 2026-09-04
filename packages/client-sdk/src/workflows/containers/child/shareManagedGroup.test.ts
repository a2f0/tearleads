import { expect, test } from "bun:test";
import {
  type ContainerGrantAccessEventBody,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  SIGNED_AT,
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
import { shareRemoteContainerWithGroup } from "./share";

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
        reciteContainer: async () => null,
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
      expectedGroupName: "Admins",
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
          reciteContainer: async () => null,
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
        expectedGroupName: "Operators",
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

import { expect, test } from "bun:test";
import {
  shareRemoteContainer,
  shareRemoteContainerWithGroup,
} from "@tearleads/client-sdk";
import {
  type AccessEvent,
  type ContainerGrantAccessEventBody,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  computeAccessEventHash,
  computeContainerKeyEpochHash,
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type KeyingCanonicalJson,
  toFingerprint,
  type VerifiedContainerAccessManifest,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  SIGNED_AT,
  tamperFirstProjectionEventSignature,
} from "../../../../test/helpers/containerFixtures";
import { buildInitialGroupPolicyRequest } from "../../organizations/principalPolicy";
import { buildInitialOrganizationPolicyRequest } from "../../registration/registerIdentity";

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
      createdAt: "2026-05-12T12:00:00.000Z",
    },
    currentPayload: {
      principalType: "group",
      principalId: request.groupId,
      stateHash,
      cipherSuite: request.initialGroupPolicy.encryptedPayload.cipherSuite,
      ciphertext: request.initialGroupPolicy.encryptedPayload.ciphertext,
      ciphertextHash:
        request.initialGroupPolicy.encryptedPayload.ciphertextHash,
      createdAt: "2026-05-12T12:00:00.000Z",
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

async function organizationPolicyBundleFromInitialRequest(
  organizationId: string,
  request: Awaited<ReturnType<typeof buildInitialOrganizationPolicyRequest>>,
): Promise<PrincipalPolicyBundleResponse> {
  const stateHash = await computePrincipalStateHash(request.state);

  return {
    currentState: {
      ...request.state,
      stateHash,
      createdAt: "2026-05-12T12:00:00.000Z",
    },
    currentPayload: {
      principalType: "organization",
      principalId: organizationId,
      stateHash,
      cipherSuite: request.encryptedPayload.cipherSuite,
      ciphertext: request.encryptedPayload.ciphertext,
      ciphertextHash: request.encryptedPayload.ciphertextHash,
      createdAt: "2026-05-12T12:00:00.000Z",
    },
    currentProjection: request.projection,
    currentMemberEnvelopes: {
      principalType: "organization",
      principalId: organizationId,
      stateHash,
      epoch: request.state.keyEpoch,
      envelopes: request.memberEnvelopes,
    },
    previousStates: [],
  };
}

test("shareRemoteContainer rejects tampered projected container state before sending", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
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
      recipientEncapsulationPublicKey: recipientKeyPair.publicKey,
      recipientUserId: "user-2",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow("Container writer projection path[0] state mismatch");
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
      recipientEncapsulationPublicKey: recipientKeyPair.publicKey,
      recipientUserId: "user-2",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow(
    "Container writer projection path[0] signature verification failed",
  );
  expect(shareCalled).toBe(false);
});

test("shareRemoteContainer includes existing direct user recipient keys", async () => {
  const parent = await createParentProjection();
  const { author, signingPublicKey } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const submittedRequests: ContainerMutationRequest[] = [];

  const shared = await shareRemoteContainer({
    accessLevel: "write",
    apiClient: {
      getContainerWriterProjection: async () => parent.projection,
      shareContainer: async (_containerId, request) => {
        submittedRequests.push(request);
        const event = request.event as unknown as AccessEvent;
        const keyEpoch = request.keyEpoch as unknown as ContainerKeyEpoch;
        const previousKek = parent.projection.containerKeks[0];
        if (!previousKek) {
          throw new Error("Expected parent projection KEK");
        }

        return {
          containerId: parent.projection.containerId,
          createdAt: "2026-05-05T00:00:00.000Z",
          organizationId: parent.projection.organizationId,
          parentId: null,
          updatedAt: "2026-05-05T00:00:00.000Z",
          manifestHead: {
            epoch: 2,
            manifestHash: request.expectedManifestHash,
          },
          accessManifest: {
            event: {
              event: request.event,
              body: request.body,
              eventHash: await computeAccessEventHash(event),
            },
            manifest: request.manifest,
            manifestHash: request.expectedManifestHash,
            state: {},
          },
          containerKek: {
            ...previousKek,
            accessManifestHash: request.expectedManifestHash,
            keyEpoch: request.keyEpoch,
            keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
            wraps: request.wraps,
          },
          referencedPrincipalHeads: [],
        };
      },
    },
    author,
    containerId: parent.projection.containerId,
    recipientEncapsulationPublicKey: recipientKeyPair.publicKey,
    recipientUserId: "user-2",
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    signedAt: SIGNED_AT,
    targetSecretKey: parent.secretKey,
  });

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
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const groupSigningKeyPair = generateSigningSeedAndKeyPair();
  const groupEncapsulationKeyPair = generateKemSeedAndKeyPair();
  const groupSignerUserId = "group-signer";
  const groupId = "group-1";
  const groupSigningFingerprint = await toFingerprint(
    groupSigningKeyPair.signingPublicKey,
  );
  const groupPolicyRequest = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: groupEncapsulationKeyPair,
    groupId,
    name: "Operators",
    signerUserId: groupSignerUserId,
    signingFingerprint: groupSigningFingerprint,
    signingKeyPair: groupSigningKeyPair,
  });
  const groupPolicy = await policyBundleFromInitialRequest(groupPolicyRequest);
  const submittedRequests: ContainerMutationRequest[] = [];

  const shared = await shareRemoteContainerWithGroup({
    accessLevel: "read",
    apiClient: {
      getContainerWriterProjection: async () => parent.projection,
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        expect(principalType).toBe("group");
        expect(principalId).toBe(groupId);
        return groupPolicy;
      },
      getEncapsulationKey: async (userId) => {
        expect(userId).toBe(groupSignerUserId);
        return {
          userId: groupSignerUserId,
          signingPublicKey: bytesToBase64(groupSigningKeyPair.signingPublicKey),
          signingKeyFingerprint: groupSigningFingerprint,
          encapsulationPublicKey: bytesToBase64(
            groupEncapsulationKeyPair.publicKey,
          ),
        };
      },
      shareContainer: async (_containerId, request) => {
        submittedRequests.push(request);
        return createMutationResponseFromRequest(request);
      },
    },
    author,
    containerId: parent.projection.containerId,
    recipientGroupId: groupId,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    signedAt: SIGNED_AT,
    targetSecretKey: parent.secretKey,
  });

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
  const groupSigningFingerprint = await toFingerprint(
    groupSigningKeyPair.signingPublicKey,
  );
  const organizationPolicyRequest = await buildInitialOrganizationPolicyRequest(
    {
      encapsulationPublicKey: groupEncapsulationKeyPair.publicKey,
      organizationId: parent.projection.organizationId,
      signingKeyPair: groupSigningKeyPair,
      userId: groupSignerUserId,
    },
  );
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    parent.projection.organizationId,
    organizationPolicyRequest,
  );
  const groupPolicyRequest = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: groupEncapsulationKeyPair,
    groupId,
    includeSignerAsAdmin: false,
    name: "Operators",
    signerUserId: groupSignerUserId,
    signingFingerprint: groupSigningFingerprint,
    signingKeyPair: groupSigningKeyPair,
  });
  const groupPolicy = await policyBundleFromInitialRequest(groupPolicyRequest);
  const submittedRequests: ContainerMutationRequest[] = [];

  const shared = await shareRemoteContainerWithGroup({
    accessLevel: "read",
    apiClient: {
      getContainerWriterProjection: async () => parent.projection,
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        if (principalType === "organization") {
          expect(principalId).toBe(parent.projection.organizationId);
          return organizationPolicy;
        }

        expect(principalId).toBe(groupId);
        return groupPolicy;
      },
      getEncapsulationKey: async (userId) => {
        expect(userId).toBe(groupSignerUserId);
        return {
          userId: groupSignerUserId,
          signingPublicKey: bytesToBase64(groupSigningKeyPair.signingPublicKey),
          signingKeyFingerprint: groupSigningFingerprint,
          encapsulationPublicKey: bytesToBase64(
            groupEncapsulationKeyPair.publicKey,
          ),
        };
      },
      shareContainer: async (_containerId, request) => {
        submittedRequests.push(request);
        return createMutationResponseFromRequest(request);
      },
    },
    author,
    containerId: parent.projection.containerId,
    recipientGroupId: groupId,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    signedAt: SIGNED_AT,
    targetSecretKey: parent.secretKey,
  });

  expect(shared).not.toBeNull();
  expect(groupPolicy.currentProjection).toEqual([]);
  expect(
    (submittedRequests[0]?.principalPolicies as Record<string, unknown>[]).map(
      (policy) => (policy as { principalId: unknown }).principalId,
    ),
  ).toEqual([groupId]);
});

test("shareRemoteContainer replaces stale wraps when re-sharing a user", async () => {
  const existingUserId = "user-2";
  const oldRecipientKeyPair = generateKemSeedAndKeyPair();
  const newRecipientKeyPair = generateKemSeedAndKeyPair();
  const oldRecipientKeyEpochId = `user:${existingUserId}:encapsulation:${await toFingerprint(oldRecipientKeyPair.publicKey)}`;
  const parent = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "read",
      publicKey: oldRecipientKeyPair.publicKey,
      recipientKeyEpochId: oldRecipientKeyEpochId,
      userId: existingUserId,
    },
  });
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const previousKek = parent.projection.containerKeks[0];
  if (!previousKek) {
    throw new Error("Expected parent projection KEK");
  }
  const existingWrap = previousKek.wraps.find(
    (wrap) =>
      Reflect.get(wrap, "recipientKind") === "user" &&
      Reflect.get(wrap, "recipientId") === existingUserId,
  );
  if (!existingWrap) {
    throw new Error("Expected existing user wrap");
  }
  const existingRecipientTarget = previousKek.recipientTargets.find(
    (target) =>
      Reflect.get(target, "recipientKind") === "user" &&
      Reflect.get(target, "recipientId") === existingUserId,
  );
  if (!existingRecipientTarget) {
    throw new Error("Expected existing user recipient target");
  }
  const projectionWithExistingShare = parent.projection;
  const submittedRequests: ContainerMutationRequest[] = [];

  const shared = await shareRemoteContainer({
    accessLevel: "write",
    apiClient: {
      getContainerWriterProjection: async () => projectionWithExistingShare,
      shareContainer: async (_containerId, request) => {
        submittedRequests.push(request);
        return createMutationResponseFromRequest(request);
      },
    },
    author,
    containerId: parent.projection.containerId,
    recipientEncapsulationPublicKey: newRecipientKeyPair.publicKey,
    recipientUserId: existingUserId,
    resolveProjectionUserKey: async (userId) => {
      if (userId === parent.userId) {
        return {
          encapsulationPublicKey: parent.encapsulationPublicKey,
          signingPublicKey: parent.signingPublicKey,
          userId,
        };
      }
      if (userId === existingUserId) {
        return {
          encapsulationPublicKey: oldRecipientKeyPair.publicKey,
          signingPublicKey: parent.signingPublicKey,
          userId,
        };
      }

      return null;
    },
    signedAt: SIGNED_AT,
    targetSecretKey: parent.secretKey,
  });

  expect(shared).not.toBeNull();
  const submittedRequest = submittedRequests[0];
  if (!submittedRequest) {
    throw new Error("Expected submitted share request");
  }
  const submittedWraps =
    submittedRequest.wraps as unknown as ContainerKeyWrap[];
  const existingUserWraps = submittedWraps.filter(
    (wrap) =>
      wrap.recipientKind === "user" && wrap.recipientId === existingUserId,
  );
  expect(existingUserWraps).toHaveLength(1);
  expect(existingUserWraps[0]?.recipientKeyEpochId).not.toBe(
    oldRecipientKeyEpochId,
  );
  expect(submittedWraps).not.toContainEqual(
    expect.objectContaining({
      recipientId: existingUserId,
      recipientKeyEpochId: oldRecipientKeyEpochId,
    }),
  );
  expect(submittedWraps).toHaveLength(previousKek.wraps.length);
});

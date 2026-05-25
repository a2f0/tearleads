import { expect, test } from "bun:test";
import { revokeRemoteContainer } from "@tearleads/client-sdk";
import {
  type AccessEvent,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerRevokeAccessEventBody,
  type ContainerUserRecipientKey,
  computeAccessEventHash,
  computeContainerKeyEpochHash,
  generateKemSeedAndKeyPair,
  type KeyingCanonicalJson,
  toFingerprint,
  type VerifiedContainerAccessManifest,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import {
  createAuthor,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  SIGNED_AT,
} from "../../../../test/helpers/containerFixtures";

test("revokeRemoteContainer removes a direct user grant and rotates the KEK", async () => {
  const revokedUserId = "user-2";
  const revokedUserKeyPair = generateKemSeedAndKeyPair();
  const revokedUserKeyEpochId = `user:${revokedUserId}:encapsulation:${await toFingerprint(revokedUserKeyPair.publicKey)}`;
  const parent = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "read",
      publicKey: revokedUserKeyPair.publicKey,
      recipientKeyEpochId: revokedUserKeyEpochId,
      userId: revokedUserId,
    },
  });
  const { author, signingPublicKey } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const submittedRequests: ContainerMutationRequest[] = [];

  const revoked = await revokeRemoteContainer({
    apiClient: {
      getContainerWriterProjection: async () => parent.projection,
      revokeContainer: async (_containerId, request) => {
        submittedRequests.push(request);
        const event = request.event as unknown as AccessEvent;
        const keyEpoch = request.keyEpoch as unknown as ContainerKeyEpoch;

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
              body: request.body as Record<string, unknown>,
              eventHash: await computeAccessEventHash(event),
            },
            manifest: request.manifest,
            manifestHash: request.expectedManifestHash,
            state: {},
          },
          containerKek: {
            containerId: parent.projection.containerId,
            accessManifestHash: request.expectedManifestHash,
            containerKeyEpochId: keyEpoch.id,
            containerKeyEpoch: keyEpoch.keyEpoch,
            keyEpoch: request.keyEpoch,
            keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
            keyTargetHash: "test-key-target-hash",
            parentContainerKeyEpochId: null,
            recipientTargets: [],
            wraps: request.wraps,
          },
          referencedPrincipalHeads: [],
        };
      },
    },
    author,
    containerId: parent.projection.containerId,
    revokedSubject: {
      subjectId: revokedUserId,
      subjectType: "user",
    },
    resolveProjectionUserKey: async (userId) => {
      if (userId === revokedUserId) {
        return {
          encapsulationPublicKey: revokedUserKeyPair.publicKey,
          signingPublicKey: parent.signingPublicKey,
          userId,
        };
      }

      return createParentProjectionUserKeyResolver(parent)(userId);
    },
    signedAt: SIGNED_AT,
    targetSecretKey: parent.secretKey,
  });

  expect(revoked).not.toBeNull();
  if (!revoked) {
    throw new Error("Expected revoke result");
  }
  const submittedRequest = submittedRequests[0];
  if (!submittedRequest) {
    throw new Error("Expected submitted revoke request");
  }

  const body =
    submittedRequest.body as unknown as ContainerRevokeAccessEventBody;
  expect(body).toEqual({
    eventType: "container.revoke",
    containerKeyEpochId: revoked.plan.containerKeyEpochId,
    subjectId: revokedUserId,
    subjectType: "user",
  });
  expect(revoked.plan.keyEpoch.keyEpoch).toBe(2);
  expect(revoked.plan.keyEpoch.id).not.toBe(
    parent.parentKekState.containerKeyEpochId,
  );
  expect(
    revoked.plan.state.directGrants.map((grant) => grant.subjectId),
  ).toEqual([parent.userId]);
  expect(
    (
      submittedRequest.userRecipientKeys as unknown as ContainerUserRecipientKey[]
    ).map((key) => key.userId),
  ).toEqual([parent.userId]);
  expect(
    (submittedRequest.wraps as unknown as ContainerKeyWrap[]).some(
      (wrap) => wrap.recipientId === revokedUserId,
    ),
  ).toBe(false);

  const verifiedEvent = await verifySignedAccessEvent({
    body: revoked.plan.body as unknown as KeyingCanonicalJson,
    event: revoked.plan.event,
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
    expectedManifestHash: revoked.plan.manifestHash,
    manifest: revoked.plan.manifest,
    previousContainerPath: [previousManifest],
    previousManifest,
  });
  expect(verifiedManifest.ok).toBe(true);
  if (!verifiedManifest.ok) {
    throw verifiedManifest.error;
  }

  const verifiedKek = await verifyContainerKekState({
    containerManifest: verifiedManifest.value,
    keyEpoch: revoked.plan.keyEpoch,
    userRecipientKeys:
      submittedRequest.userRecipientKeys as unknown as ContainerUserRecipientKey[],
    wraps: revoked.plan.wraps,
  });
  expect(verifiedKek.ok).toBe(true);
  if (!verifiedKek.ok) {
    throw verifiedKek.error;
  }
  const remainingUserRecipientKey = revoked.plan.userRecipientKeys[0];
  if (!remainingUserRecipientKey) {
    throw new Error("Expected remaining user recipient key");
  }
  expect(verifiedKek.value.recipientTargets).toEqual([
    {
      recipientKind: "user",
      recipientId: parent.userId,
      recipientKeyEpochId: remainingUserRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint:
        remainingUserRecipientKey.recipientKeyFingerprint,
    },
  ]);
});

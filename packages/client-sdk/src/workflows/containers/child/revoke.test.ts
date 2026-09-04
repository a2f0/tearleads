import { expect, test } from "bun:test";
import {
  type ContainerKeyWrap,
  type ContainerRevokeAccessEventBody,
  type ContainerUserRecipientKey,
  computeContainerKekKeyringHash,
  computeContainerKekPredecessorBridgeHash,
  generateKemSeedAndKeyPair,
  type KeyingCanonicalJson,
  normalizeContainerKekKeyring,
  openContainerKekKeyring,
  toFingerprint,
  type VerifiedContainerAccessManifest,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
  SIGNED_AT,
} from "../../../../test/helpers/containerFixtures";
import { revokeRemoteContainer } from "./revoke";

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
  const mutationResponses: ContainerMutationResponse[] = [];
  const database = await createTestExecSql("remote-container-revoke");
  const resolveRevokedUserKey = createRecipientIdentityResolver({
    encapsulationPublicKey: revokedUserKeyPair.publicKey,
    signingKeyFingerprint: parent.author.signerKeyFingerprint,
    signingPublicKey: parent.signingPublicKey,
  });

  const revoked = await revokeRemoteContainer({
    apiClient: {
      reciteContainer: async () => null,
      getContainerWriterProjection: async () => parent.projection,
      revokeContainer: async (_containerId, request) => {
        submittedRequests.push(request);
        const response = await createMutationResponseFromRequest(
          request,
          parent.projection.containerKeks.at(-1),
        );
        mutationResponses.push(response);
        return response;
      },
    },
    author,
    containerId: parent.projection.containerId,
    execSql: database.execSql,
    revokedSubject: {
      subjectId: revokedUserId,
      subjectType: "user",
    },
    resolveProjectionUserKey: async (userId) =>
      userId === revokedUserId
        ? resolveRevokedUserKey(userId)
        : createParentProjectionUserKeyResolver(parent)(userId),
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
    keyringHash: body.keyringHash,
    predecessorBridgeHash: body.predecessorBridgeHash,
    subjectId: revokedUserId,
    subjectType: "user",
  });
  expect(body.predecessorBridgeHash).toBe(
    await computeContainerKekPredecessorBridgeHash(
      submittedRequest.predecessorBridge,
    ),
  );
  if (!submittedRequest.keyring) {
    throw new Error("Expected submitted rotation keyring");
  }
  expect(body.keyringHash).toBe(
    await computeContainerKekKeyringHash(submittedRequest.keyring),
  );
  expect(revoked.plan.keyEpoch.keyEpoch).toBe(2);
  expect(revoked.plan.keyEpoch.id).not.toBe(
    parent.parentKekState.containerKeyEpochId,
  );
  const mutationResponse = mutationResponses[0];
  const responseKeyring = mutationResponse?.containerKek.keyring;
  if (!responseKeyring) {
    throw new Error("Expected rotated container KEK keyring in the response");
  }
  expect(responseKeyring).toEqual(
    submittedRequest.keyring as unknown as typeof responseKeyring,
  );
  const keyringEntries = await openContainerKekKeyring({
    keyEpoch: revoked.plan.keyEpoch.keyEpoch,
    keyring: normalizeContainerKekKeyring(responseKeyring),
    successorContainerKey: revoked.containerKey,
  });
  expect(keyringEntries.map((entry) => entry.containerKeyEpochId)).toEqual([
    parent.parentKekState.containerKeyEpochId,
  ]);
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
  database.close();
});

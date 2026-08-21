import { expect, test } from "bun:test";
import {
  type ContainerKeyWrap,
  generateKemSeedAndKeyPair,
  toFingerprint,
} from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { ContainerMutationRequest } from "@symcrypt/validators/request";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createRecipientIdentityResolver,
  SIGNED_AT,
} from "../../../../test/helpers/containerFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { shareRemoteContainer } from "./share";

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
  const projectionWithExistingShare = parent.projection;
  const submittedRequests: ContainerMutationRequest[] = [];
  const database = await createTestExecSql("container-reshare-user");

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
    execSql: database.execSql,
    recipientUserId: existingUserId,
    resolveProjectionUserKey: async (userId) => {
      if (userId === parent.userId) {
        return createTestTrustedUserIdentity({
          encapsulationPublicKey: parent.encapsulationPublicKey,
          signingKeyFingerprint: parent.author.signerKeyFingerprint,
          signingPublicKey: parent.signingPublicKey,
          userId,
        });
      }
      if (userId === existingUserId) {
        return createTestTrustedUserIdentity({
          encapsulationPublicKey: oldRecipientKeyPair.publicKey,
          signingKeyFingerprint: parent.author.signerKeyFingerprint,
          signingPublicKey: parent.signingPublicKey,
          userId,
        });
      }

      return null;
    },
    resolveTrustedUserIdentity: createRecipientIdentityResolver({
      encapsulationPublicKey: newRecipientKeyPair.publicKey,
      signingKeyFingerprint: parent.author.signerKeyFingerprint,
      signingPublicKey: parent.signingPublicKey,
    }),
    signedAt: SIGNED_AT,
    targetSecretKey: parent.secretKey,
  });
  database.close();

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

import { expect, test } from "bun:test";
import {
  type ContainerKeyWrap,
  generateKemSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/containerMutationServiceFixture";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createRecipientIdentityResolver,
  SIGNED_AT,
} from "../../../../../test/helpers/data/containerFixtures";
import { createTestTrustedUserIdentity } from "../../../../../test/helpers/data/trustedUserIdentity";

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

  const shared = await createContainerMutationServiceFixture({
    reportSecurityIncident: async () => {},
    api: {
      reciteContainer: async () => null,
      getContainerWriterProjection: async () => projectionWithExistingShare,
      shareContainer: async (_containerId, request) => {
        submittedRequests.push(request);
        return createMutationResponseFromRequest(request);
      },
    },
    execSql: database.execSql,
    resolveTrustedUserIdentity: createRecipientIdentityResolver({
      encapsulationPublicKey: newRecipientKeyPair.publicKey,
      signingKeyFingerprint: parent.author.signerKeyFingerprint,
      signingPublicKey: parent.signingPublicKey,
    }),
    encapsulationSecretKey: parent.secretKey,
  }).shareRemoteContainer({
    accessLevel: "write",
    author,
    containerId: parent.projection.containerId,
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
    signedAt: SIGNED_AT,
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

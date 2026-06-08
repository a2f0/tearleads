import { expect, test } from "bun:test";
import { shareRemoteContainer } from "@tearleads/client-sdk";
import {
  type ContainerKeyWrap,
  generateKemSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  SIGNED_AT,
} from "../../../../test/helpers/containerFixtures";

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

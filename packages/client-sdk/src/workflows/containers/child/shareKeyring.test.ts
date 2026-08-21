import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
  SIGNED_AT,
} from "../../../../test/helpers/containerFixtures";
import { shareRemoteContainer } from "./share";

test("shareRemoteContainer rejects a response that drops the unchanged keyring", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const database = await createTestExecSql("container-share-keyring-tamper");

  // Give the epoch a keyring, so the share has an immutable artifact to keep.
  const sealedKeyring = {
    version: 1,
    sealingSuite: "symcrypt.container-kek-keyring.aes-256-gcm-current-kek",
    containerId: parent.projection.containerId,
    containerKeyEpochId:
      parent.projection.containerKeks.at(-1)?.containerKeyEpochId ?? "",
    iv: "A".repeat(16),
    sealed: "A".repeat(120),
  };
  const projectionWithKeyring = {
    ...parent.projection,
    containerKeks: parent.projection.containerKeks.map((kek, index, all) =>
      index === all.length - 1 ? { ...kek, keyring: sealedKeyring } : kek,
    ),
  };

  // A share keeps its epoch, so the response must echo that exact keyring.
  // A server that drops it is rewriting immutable state.
  await expect(
    shareRemoteContainer({
      accessLevel: "read",
      apiClient: {
        getContainerWriterProjection: async () => projectionWithKeyring,
        shareContainer: async (_containerId, request) => {
          const response = await createMutationResponseFromRequest(request);
          return {
            ...response,
            containerKek: { ...response.containerKek, keyring: null },
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
    }),
  ).rejects.toThrow("dropped its unchanged keyring");
  database.close();
});

test("shareRemoteContainer rejects a keyring injected into an epoch that had none", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const database = await createTestExecSql("container-share-keyring-inject");

  // The epoch has no keyring (epoch 1). A response that invents one would
  // become the next writer projection's history, so it must be refused.
  const injected = {
    version: 1,
    sealingSuite: "symcrypt.container-kek-keyring.aes-256-gcm-current-kek",
    containerId: parent.projection.containerId,
    containerKeyEpochId:
      parent.projection.containerKeks.at(-1)?.containerKeyEpochId ?? "",
    iv: "A".repeat(16),
    sealed: "A".repeat(120),
  };

  await expect(
    shareRemoteContainer({
      accessLevel: "read",
      apiClient: {
        getContainerWriterProjection: async () => parent.projection,
        shareContainer: async (_containerId, request) => {
          const response = await createMutationResponseFromRequest(request);
          return {
            ...response,
            containerKek: { ...response.containerKek, keyring: injected },
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
    }),
  ).rejects.toThrow("added a keyring to an unchanged epoch");
  database.close();
});

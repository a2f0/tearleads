import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import {
  createAuthor,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../../test/helpers/containerFixtures";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/containerMutationServiceFixture";
import { createTestTrustedUserIdentity } from "../../../../../test/helpers/trustedUserIdentity";
import { withTestExecSql } from "../../../../../test/helpers/withTestExecSql";

test("shareRemoteContainer stops before network I/O on trusted identity failure", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "recipient identity changed",
  );
  let projectionRead = false;
  let shareCalled = false;

  await withTestExecSql("container-share-identity-failure", async (execSql) => {
    await expect(
      createContainerMutationServiceFixture({
        reportSecurityIncident: async () => {},
        api: {
          reciteContainer: async () => null,
          getContainerWriterProjection: async () => {
            projectionRead = true;
            return parent.projection;
          },
          shareContainer: async () => {
            shareCalled = true;
            return null;
          },
        },
        execSql,
        resolveTrustedUserIdentity: async () => {
          throw integrityError;
        },
        encapsulationSecretKey: parent.secretKey,
      }).shareRemoteContainer({
        accessLevel: "read",
        author,
        containerId: parent.projection.containerId,
        recipientUserId: "user-2",
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      }),
    ).rejects.toBe(integrityError);
  });

  expect(projectionRead).toBe(false);
  expect(shareCalled).toBe(false);
});

test("shareRemoteContainer rejects an identity bound to another user before reads or writes", async () => {
  const parent = await createParentProjection();
  const recipientKeyPair = generateKemSeedAndKeyPair();
  let projectionRead = false;
  let shareCalled = false;

  await withTestExecSql("container-share-unbound-identity", async (execSql) => {
    await expect(
      createContainerMutationServiceFixture({
        reportSecurityIncident: async () => {},
        api: {
          reciteContainer: async () => null,
          getContainerWriterProjection: async () => {
            projectionRead = true;
            return parent.projection;
          },
          shareContainer: async () => {
            shareCalled = true;
            return null;
          },
        },
        execSql,
        resolveTrustedUserIdentity: async () =>
          createTestTrustedUserIdentity({
            encapsulationPublicKey: recipientKeyPair.publicKey,
            signingKeyFingerprint: parent.author.signerKeyFingerprint,
            signingPublicKey: parent.signingPublicKey,
            userId: "different-user",
          }),
        encapsulationSecretKey: parent.secretKey,
      }).shareRemoteContainer({
        accessLevel: "read",
        author: parent.author,
        containerId: parent.projection.containerId,
        recipientUserId: "user-2",
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
  });

  expect(projectionRead).toBe(false);
  expect(shareCalled).toBe(false);
});

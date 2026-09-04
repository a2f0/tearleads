import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import {
  createAuthor,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { shareRemoteContainer } from "./share";

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
      shareRemoteContainer({
        reportSecurityIncident: async () => {},
        accessLevel: "read",
        apiClient: {
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
        author,
        containerId: parent.projection.containerId,
        execSql,
        recipientUserId: "user-2",
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        resolveTrustedUserIdentity: async () => {
          throw integrityError;
        },
        targetSecretKey: parent.secretKey,
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
      shareRemoteContainer({
        reportSecurityIncident: async () => {},
        accessLevel: "read",
        apiClient: {
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
        author: parent.author,
        containerId: parent.projection.containerId,
        execSql,
        recipientUserId: "user-2",
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        resolveTrustedUserIdentity: async () =>
          createTestTrustedUserIdentity({
            encapsulationPublicKey: recipientKeyPair.publicKey,
            signingKeyFingerprint: parent.author.signerKeyFingerprint,
            signingPublicKey: parent.signingPublicKey,
            userId: "different-user",
          }),
        targetSecretKey: parent.secretKey,
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
  });

  expect(projectionRead).toBe(false);
  expect(shareCalled).toBe(false);
});

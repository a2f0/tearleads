import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import { createAuthor } from "../../../test/helpers/documentFixturePrimitives";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import { verifyContainerWriterProjection } from "./containerProjectionVerification";
import { ProjectionVerificationCancelledError } from "./types";

async function createVerificationFixture() {
  const { author, signingPublicKey } = await createAuthor();
  const encapsulationPublicKey = generateKemSeedAndKeyPair().publicKey;
  const projection = await createContainerWriterProjectionFixture({
    containerId: "generation-container",
    encapsulationPublicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  return {
    projection,
    resolveUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
  };
}

test("container verification surfaces cancellation after valid work expires", async () => {
  const fixture = await createVerificationFixture();
  const database = await createTestExecSql("container-verification-cancelled");
  let current = true;

  try {
    await expect(
      verifyContainerWriterProjection({
        execSql: database.execSql,
        projection: fixture.projection,
        resolveUserKey: async (userId) => {
          const identity = await fixture.resolveUserKey(userId);
          current = false;
          return identity;
        },
        stillCurrent: () => current,
      }),
    ).rejects.toBeInstanceOf(ProjectionVerificationCancelledError);
  } finally {
    database.close();
  }
});

test("container verification never masks a failure after expiry", async () => {
  const fixture = await createVerificationFixture();
  const database = await createTestExecSql("container-verification-failure");
  const failure = new KeyingVerificationError(
    "invalid_shape",
    "trusted identity verification failed",
  );
  let current = true;

  try {
    await expect(
      verifyContainerWriterProjection({
        execSql: database.execSql,
        projection: fixture.projection,
        resolveUserKey: async () => {
          current = false;
          throw failure;
        },
        stillCurrent: () => current,
      }),
    ).rejects.toBe(failure);
  } finally {
    database.close();
  }
});

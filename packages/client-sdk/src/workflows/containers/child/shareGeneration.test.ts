import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  createAuthor,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
} from "../../../../test/helpers/containerFixtures";
import { shareRemoteContainer } from "./share";

test("shareRemoteContainer does not submit after its generation expires during planning", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const database = await createTestExecSql("container-share-generation");
  let current = true;
  let shareCallCount = 0;

  try {
    const shared = await shareRemoteContainer({
      accessLevel: "write",
      apiClient: {
        getContainerWriterProjection: async () => {
          current = false;
          return parent.projection;
        },
        shareContainer: async () => {
          shareCallCount += 1;
          throw new Error("A stale share must not be submitted");
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
      stillCurrent: () => current,
      targetSecretKey: parent.secretKey,
    });

    expect(shared).toBeNull();
    expect(shareCallCount).toBe(0);
  } finally {
    database.close();
  }
});

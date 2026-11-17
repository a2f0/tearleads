import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
} from "../../../../../test/helpers/data/containerFixtures";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/workflows/containerMutationServiceFixture";
import { KeyingCheckpointRepository } from "../../../../data/persistence/keyingCheckpoints/keyingCheckpointRepository";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";

test("share planning rolls back checkpoints after its generation expires", async () => {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const database = await createTestExecSql("container-share-generation");
  let shareCallCount = 0;
  let transactionStarted = false;
  const guardedExecSql = (async (...args: Parameters<ExecSql>) => {
    const rows = await database.execSql(...args);
    if (args[0].trim().toUpperCase().startsWith("BEGIN")) {
      transactionStarted = true;
    }
    return rows;
  }) as ExecSql;

  try {
    const shared = await createContainerMutationServiceFixture({
      reportSecurityIncident: async () => {},
      api: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async () => parent.projection,
        shareContainer: async () => {
          shareCallCount += 1;
          throw new Error("A stale share must not be submitted");
        },
      },
      execSql: guardedExecSql,
      resolveTrustedUserIdentity: createRecipientIdentityResolver({
        encapsulationPublicKey: recipientKeyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey: parent.signingPublicKey,
      }),
      encapsulationSecretKey: parent.secretKey,
    }).shareRemoteContainer({
      accessLevel: "write",
      author,
      containerId: parent.projection.containerId,
      recipientUserId: "user-2",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      stillCurrent: () => !transactionStarted,
    });

    expect(shared).toBeNull();
    expect(transactionStarted).toBe(true);
    expect(shareCallCount).toBe(0);
    await expect(
      new KeyingCheckpointRepository(
        database.execSql,
      ).loadAccessManifestCheckpoint(
        "container",
        parent.projection.organizationId,
        parent.projection.containerId,
      ),
    ).resolves.toBeNull();
  } finally {
    database.close();
  }
});

test.each([false, true])(
  "shareRemoteContainer respects a refused checkpoint commit (guard revives: %s)",
  async (reviveGuard) => {
    const parent = await createParentProjection();
    const { author } = await createAuthor({
      organizationId: parent.projection.organizationId,
      userId: parent.userId,
    });
    const recipientKeyPair = generateKemSeedAndKeyPair();
    const database = await createTestExecSql(
      "container-share-submit-generation",
    );
    let current = true;

    try {
      const shared = await createContainerMutationServiceFixture({
        reportSecurityIncident: async () => {},
        api: {
          reciteContainer: async () => null,
          getContainerWriterProjection: async () => parent.projection,
          shareContainer: async (_containerId, request) => {
            const response = await createMutationResponseFromRequest(request);
            current = false;
            return response;
          },
        },
        execSql: database.execSql,
        resolveTrustedUserIdentity: createRecipientIdentityResolver({
          encapsulationPublicKey: recipientKeyPair.publicKey,
          signingKeyFingerprint: author.signerKeyFingerprint,
          signingPublicKey: parent.signingPublicKey,
        }),
        encapsulationSecretKey: parent.secretKey,
      }).shareRemoteContainer({
        accessLevel: "write",
        author,
        containerId: parent.projection.containerId,
        recipientUserId: "user-2",
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        stillCurrent: () => {
          const permitted = current;
          // A later guard evaluation cannot turn a rolled-back acknowledgement
          // into a completed mutation, even if the host reports current again.
          if (reviveGuard) current = true;
          return permitted;
        },
      });

      expect(shared).toBeNull();
      await expect(
        new KeyingCheckpointRepository(
          database.execSql,
        ).loadAccessManifestCheckpoint(
          "container",
          parent.projection.organizationId,
          parent.projection.containerId,
        ),
      ).resolves.toMatchObject({ epoch: 1 });
    } finally {
      database.close();
    }
  },
);

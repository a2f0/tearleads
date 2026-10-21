import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
} from "../../../../../test/helpers/containerFixtures";
import { loadAccessManifestCheckpoint } from "../../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import { shareRemoteContainer } from "./index";

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
    const shared = await shareRemoteContainer({
      reportSecurityIncident: async () => {},
      accessLevel: "write",
      apiClient: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async () => parent.projection,
        shareContainer: async () => {
          shareCallCount += 1;
          throw new Error("A stale share must not be submitted");
        },
      },
      author,
      containerId: parent.projection.containerId,
      execSql: guardedExecSql,
      recipientUserId: "user-2",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: createRecipientIdentityResolver({
        encapsulationPublicKey: recipientKeyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey: parent.signingPublicKey,
      }),
      stillCurrent: () => !transactionStarted,
      targetSecretKey: parent.secretKey,
    });

    expect(shared).toBeNull();
    expect(transactionStarted).toBe(true);
    expect(shareCallCount).toBe(0);
    await expect(
      loadAccessManifestCheckpoint(
        database.execSql,
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
      const shared = await shareRemoteContainer({
        reportSecurityIncident: async () => {},
        accessLevel: "write",
        apiClient: {
          reciteContainer: async () => null,
          getContainerWriterProjection: async () => parent.projection,
          shareContainer: async (_containerId, request) => {
            const response = await createMutationResponseFromRequest(request);
            current = false;
            return response;
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
        stillCurrent: () => {
          const permitted = current;
          // A later guard evaluation cannot turn a rolled-back acknowledgement
          // into a completed mutation, even if the host reports current again.
          if (reviveGuard) current = true;
          return permitted;
        },
        targetSecretKey: parent.secretKey,
      });

      expect(shared).toBeNull();
      await expect(
        loadAccessManifestCheckpoint(
          database.execSql,
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

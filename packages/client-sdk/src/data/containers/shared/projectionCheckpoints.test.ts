import { expect, test } from "bun:test";
import {
  computeContainerKekKeyringHash,
  computeContainerKekMaterialId,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  KeyingVerificationError,
  sealContainerKekKeyring,
  toFingerprint,
  type VerifiedContainerAccessManifest,
} from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { AccessManifestBundleWireResponse } from "@symcrypt/validators/response";
import {
  createContainerRevokeManifestFixture,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { unwrapContainerKekPath } from "../../documents/shared/containerKekPath";
import { verifyContainerWriterProjection } from "../../keyingProjectionVerification";
import { enforceAccessManifestCheckpoints } from "../../keyingProjectionVerification/accessManifestCheckpointEnforcement";
import { loadAccessManifestCheckpoint } from "../../persistence/keyingCheckpointPersistence";

test("hidden future history cannot bypass a persisted projection head", async () => {
  const secondUserId = "user-2";
  const secondUserKem = generateKemSeedAndKeyPair();
  const secondUserSigning = generateSigningSeedAndKeyPair();
  const secondUserFingerprint = await toFingerprint(secondUserKem.publicKey);
  const parent = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "write",
      publicKey: secondUserKem.publicKey,
      recipientKeyEpochId: `user:${secondUserId}:encapsulation:${secondUserFingerprint}`,
      userId: secondUserId,
    },
  });
  const epoch1 = parent.projection.path[0];
  if (!epoch1) {
    throw new Error("Expected epoch-1 projection manifest");
  }
  const rotatedContainerKek = crypto.getRandomValues(new Uint8Array(32));
  const rotatedContainerKeyEpochId = await computeContainerKekMaterialId({
    containerId: parent.parentKekState.containerId,
    keyEpoch: parent.parentKekState.containerKeyEpoch + 1,
    keyMaterial: rotatedContainerKek,
  });
  const keyring = await sealContainerKekKeyring({
    containerId: parent.parentKekState.containerId,
    entries: [
      {
        containerKeyEpochId: parent.parentKekState.containerKeyEpochId,
        keyMaterial: parent.parentContainerKek,
      },
    ],
    keyEpoch: parent.parentKekState.containerKeyEpoch + 1,
    successorContainerKey: rotatedContainerKek,
    successorContainerKeyEpochId: rotatedContainerKeyEpochId,
  });
  const epoch2 = await createContainerRevokeManifestFixture({
    author: parent.author,
    containerId: parent.parentKekState.containerId,
    containerKeyEpochId: rotatedContainerKeyEpochId,
    eventId: "parent-container-revoke-event-2",
    keyringHash: await computeContainerKekKeyringHash(keyring),
    organizationId: parent.projection.organizationId,
    predecessorBridgeHash: "0".repeat(64),
    previousManifest: epoch1 as unknown as VerifiedContainerAccessManifest,
    subjectId: secondUserId,
    subjectType: "user",
    signingPublicKey: parent.signingPublicKey,
  });
  const { close, execSql } = await createTestExecSql(
    "projection-hidden-history-checkpoint",
  );

  try {
    await enforceAccessManifestCheckpoints({
      execSql,
      policies: [],
      verifiedHeads: [epoch2],
      verifiedManifests: [epoch2],
    });
    const staleProjection = structuredClone(parent.projection);
    const staleKek = staleProjection.containerKeks[0];
    if (!staleKek) {
      throw new Error("Expected stale projection KEK");
    }
    staleKek.containerManifestHistory = [
      epoch2 as unknown as AccessManifestBundleWireResponse,
    ];

    let thrown: unknown;
    try {
      await unwrapContainerKekPath({
        execSql,
        projection: staleProjection,
        resolveProjectionUserKey: async (userId) => {
          if (userId === parent.userId) {
            return createTestTrustedUserIdentity({
              encapsulationPublicKey: parent.encapsulationPublicKey,
              signingKeyFingerprint: parent.author.signerKeyFingerprint,
              signingPublicKey: parent.signingPublicKey,
              userId,
            });
          }
          if (userId === secondUserId) {
            return createTestTrustedUserIdentity({
              encapsulationPublicKey: secondUserKem.publicKey,
              signingKeyFingerprint: "second-user-signing-fingerprint",
              signingPublicKey: secondUserSigning.signingPublicKey,
              userId,
            });
          }
          return null;
        },
        secretKey: parent.secretKey,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(KeyingVerificationError);
    expect((thrown as KeyingVerificationError).code).toBe("rollback");
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        parent.projection.organizationId,
        parent.projection.containerId,
      ),
    ).resolves.toMatchObject({ epoch: 2, manifestHash: epoch2.manifestHash });
  } finally {
    close();
  }
});

test("a valid same-epoch projection fork hard-fails before unwrap", async () => {
  const first = await createParentProjection();
  const fork = await createParentProjection();
  const firstManifest = first.projection.path[0];
  if (!firstManifest) {
    throw new Error("Expected the first projection manifest");
  }
  const { close, execSql } = await createTestExecSql(
    "projection-same-epoch-fork",
  );

  try {
    await unwrapContainerKekPath({
      execSql,
      projection: first.projection,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(first),
      secretKey: first.secretKey,
    });
    await expect(
      unwrapContainerKekPath({
        execSql,
        projection: fork.projection,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(fork),
        secretKey: fork.secretKey,
      }),
    ).rejects.toMatchObject({ code: "equivocation" });
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        first.projection.organizationId,
        first.projection.containerId,
      ),
    ).resolves.toMatchObject({
      epoch: 1,
      manifestHash: firstManifest.manifestHash,
    });
  } finally {
    close();
  }
});

test("explicit local projection trust does not require durable storage", async () => {
  const parent = await createParentProjection();

  await expect(
    unwrapContainerKekPath({
      projection: parent.projection,
      secretKey: parent.secretKey,
      trustedLocalProjection: true,
    }),
  ).resolves.toBeInstanceOf(Map);
});

test("remote projection verification requires durable storage", async () => {
  const parent = await createParentProjection();
  const missingCheckpointStorage = {
    projection: parent.projection,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    secretKey: parent.secretKey,
  } as unknown as Parameters<typeof unwrapContainerKekPath>[0];

  await expect(
    unwrapContainerKekPath(missingCheckpointStorage),
  ).rejects.toMatchObject({ code: "missing_dependency" });
});

test("the low-level remote verifier rejects the local trust escape hatch", async () => {
  const parent = await createParentProjection();
  const bypassAttempt = {
    projection: parent.projection,
    resolveUserKey: createParentProjectionUserKeyResolver(parent),
    trustedLocalProjection: true,
  } as unknown as Parameters<typeof verifyContainerWriterProjection>[0];

  await expect(
    verifyContainerWriterProjection(bypassAttempt),
  ).rejects.toMatchObject({ code: "missing_dependency" });
});

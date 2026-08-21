import { expect, test } from "bun:test";
import {
  computeContainerKekKeyringHash,
  computeContainerKekMaterialId,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  sealContainerKekKeyring,
  toFingerprint,
  type VerifiedContainerAccessManifest,
} from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import type {
  AccessManifestBundleWireResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import {
  createContainerRevokeManifestFixture,
  createParentProjection,
} from "../../../../test/helpers/containerFixtures";
import { createResponse } from "../../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { buildMaterializedDocumentCreatePlan } from "../../../workflows/documents/create";
import { verifyDocumentWriterProjection } from "../../keyingProjectionVerification";
import { loadAccessManifestCheckpoint } from "../../persistence/keyingCheckpointPersistence";

test("document dependency evidence cannot hide a newer container head", async () => {
  const revokedUserId = "revoked-user";
  const revokedUserKem = generateKemSeedAndKeyPair();
  const revokedUserSigning = generateSigningSeedAndKeyPair();
  const revokedUserFingerprint = await toFingerprint(revokedUserKem.publicKey);
  const parent = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "write",
      publicKey: revokedUserKem.publicKey,
      recipientKeyEpochId: `user:${revokedUserId}:encapsulation:${revokedUserFingerprint}`,
      userId: revokedUserId,
    },
  });
  const firstManifest = parent.projection.path[0];
  if (!firstManifest) {
    throw new Error("Expected initial container manifest");
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
  const secondManifest = await createContainerRevokeManifestFixture({
    author: parent.author,
    containerId: parent.parentKekState.containerId,
    containerKeyEpochId: rotatedContainerKeyEpochId,
    eventId: "document-dependency-container-revoke",
    keyringHash: await computeContainerKekKeyringHash(keyring),
    organizationId: parent.projection.organizationId,
    predecessorBridgeHash: "0".repeat(64),
    previousManifest:
      firstManifest as unknown as VerifiedContainerAccessManifest,
    subjectId: revokedUserId,
    subjectType: "user",
    signingPublicKey: parent.signingPublicKey,
  });
  const created = await buildMaterializedDocumentCreatePlan({
    author: parent.author,
    containerProjection: parent.projection,
    documentId: "document-hidden-newer-container-dependency",
    targetSecretKey: parent.secretKey,
    trustedLocalProjection: true,
  });
  const response = createResponse(created.plan);
  const projection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [parent.projection],
    contentKeyBundle: response.contentKeyBundle,
    documentId: response.id,
    documentKekTargets: response.documentKekTargets,
    documentManifest: response.accessManifest,
    documentManifestHistory: [],
    documentManifestContainerPaths: [
      [secondManifest as unknown as AccessManifestBundleWireResponse],
    ],
    documentContainerManifestHistory: [],
  };
  const { close, execSql } = await createTestExecSql(
    "document-hidden-newer-container-dependency",
  );

  try {
    await expect(
      verifyDocumentWriterProjection({
        execSql,
        projection,
        resolveUserKey: async (userId) => {
          if (userId === parent.userId) {
            return createTestTrustedUserIdentity({
              encapsulationPublicKey: parent.encapsulationPublicKey,
              signingKeyFingerprint: parent.author.signerKeyFingerprint,
              signingPublicKey: parent.signingPublicKey,
              userId,
            });
          }
          if (userId === revokedUserId) {
            return createTestTrustedUserIdentity({
              encapsulationPublicKey: revokedUserKem.publicKey,
              signingKeyFingerprint: "revoked-user-signing-fingerprint",
              signingPublicKey: revokedUserSigning.signingPublicKey,
              userId,
            });
          }
          return null;
        },
      }),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        parent.projection.organizationId,
        parent.projection.containerId,
      ),
    ).resolves.toBeNull();
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "document",
        parent.projection.organizationId,
        response.id,
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

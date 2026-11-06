import {
  type ContainerKeyEpoch,
  computeContainerKekKeyringHash,
  computeContainerKekMaterialId,
  computeContainerKekPredecessorBridgeHash,
  createContainerKekPredecessorBridge,
  deriveContainerKekWrappingPublicKey,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  sealContainerKekKeyring,
  toFingerprint,
  type VerifiedContainerAccessManifest,
  verifyContainerKekState,
} from "@tearleads/crypto";
import type { TestExecSql } from "@tearleads/test-utils";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { unwrapContainerKekPath } from "../../src/data/documents/shared/containerKek/containerKekPath";
import { buildMaterializedDocumentCreatePlan } from "../../src/workflows/documents/create";
import {
  createContainerRevokeManifestFixture,
  createParentProjection,
  createUserContainerWrap,
  SIGNED_AT,
} from "./containerFixtures";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

/**
 * A parent container shared with a second user, then rotated to a new KEK
 * epoch by a manifest that revokes that user. The revoked user unwraps the
 * pre-revocation KEK first, as a member would have before the rotation.
 */
export async function createRevokedRotationFixture(execSql: TestExecSql) {
  const revokedUserId = "user-2";
  const revokedKeyPair = generateKemSeedAndKeyPair();
  const revokedSigning = generateSigningSeedAndKeyPair();
  const revokedRecipientKeyFingerprint = await toFingerprint(
    revokedKeyPair.publicKey,
  );
  const revokedRecipientKeyEpochId = `user:${revokedUserId}:encapsulation:${revokedRecipientKeyFingerprint}`;
  const parent = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "write",
      publicKey: revokedKeyPair.publicKey,
      recipientKeyEpochId: revokedRecipientKeyEpochId,
      userId: revokedUserId,
    },
  });
  const resolveProjectionUserKey = async (userId: string) => {
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
        encapsulationPublicKey: revokedKeyPair.publicKey,
        signingKeyFingerprint: "revoked-user-signing-fingerprint",
        signingPublicKey: revokedSigning.signingPublicKey,
        userId,
      });
    }

    return null;
  };
  const revokedUserPreviousKeks = await unwrapContainerKekPath({
    execSql,
    projection: parent.projection,
    resolveProjectionUserKey,
    secretKey: revokedKeyPair.secretKey,
  });
  const previousContainerKek = revokedUserPreviousKeks.get(
    parent.parentKekState.containerKeyEpochId,
  );
  if (!previousContainerKek) {
    throw new Error("Expected revoked user to unwrap the pre-revocation KEK");
  }

  const previousManifest = parent.projection
    .path[0] as unknown as VerifiedContainerAccessManifest;
  const rotatedContainerKek = crypto.getRandomValues(new Uint8Array(32));
  const rotatedContainerKeyEpochId = await computeContainerKekMaterialId({
    containerId: parent.parentKekState.containerId,
    keyEpoch: parent.parentKekState.containerKeyEpoch + 1,
    keyMaterial: rotatedContainerKek,
  });
  const predecessorBridge = await createContainerKekPredecessorBridge({
    containerId: parent.parentKekState.containerId,
    predecessorContainerKey: parent.parentContainerKek,
    predecessorContainerKeyEpochId: parent.parentKekState.containerKeyEpochId,
    successorContainerKey: rotatedContainerKek,
    successorContainerKeyEpochId: rotatedContainerKeyEpochId,
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
  const revokedManifest = await createContainerRevokeManifestFixture({
    containerKeyPublicKey: await deriveContainerKekWrappingPublicKey({
      containerId: parent.parentKekState.containerId,
      keyMaterial: rotatedContainerKek,
    }),
    author: parent.author,
    containerId: parent.parentKekState.containerId,
    containerKeyEpochId: rotatedContainerKeyEpochId,
    eventId: "parent-container-revoke-event-2",
    keyringHash: await computeContainerKekKeyringHash(keyring),
    organizationId: parent.projection.organizationId,
    predecessorBridgeHash:
      await computeContainerKekPredecessorBridgeHash(predecessorBridge),
    previousManifest,
    subjectId: revokedUserId,
    subjectType: "user",
    signingPublicKey: parent.signingPublicKey,
  });
  const ownerRecipientKeyFingerprint = await toFingerprint(
    parent.encapsulationPublicKey,
  );
  const ownerRecipientKeyEpochId = `user:${parent.userId}:encapsulation:${ownerRecipientKeyFingerprint}`;
  const ownerWrap = await createUserContainerWrap({
    containerKeyEpochId: rotatedContainerKeyEpochId,
    containerKek: rotatedContainerKek,
    publicKey: parent.encapsulationPublicKey,
    recipientKeyEpochId: ownerRecipientKeyEpochId,
    userId: parent.userId,
    wrapManifestHash: revokedManifest.manifestHash,
  });
  const rotatedKeyEpoch: ContainerKeyEpoch = {
    id: rotatedContainerKeyEpochId,
    containerId: parent.parentKekState.containerId,
    keyEpoch: parent.parentKekState.containerKeyEpoch + 1,
    accessManifestHash: revokedManifest.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: revokedManifest.event.eventHash,
    createdByManifestHash: revokedManifest.manifestHash,
  };
  const verifiedRotatedKek = await verifyContainerKekState({
    containerManifest: revokedManifest,
    keyEpoch: rotatedKeyEpoch,
    userRecipientKeys: [
      {
        recipientKeyEpochId: ownerWrap.recipientKeyEpochId,
        recipientKeyFingerprint: ownerWrap.recipientKeyFingerprint,
        userId: parent.userId,
      },
    ],
    wraps: [ownerWrap],
  });
  if (!verifiedRotatedKek.ok) {
    throw verifiedRotatedKek.error;
  }
  const rotatedKekState = verifiedRotatedKek.value;
  const revokedProjection: ContainerWriterProjectionResponse = {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    containerId: parent.projection.containerId,
    organizationId: parent.projection.organizationId,
    path: [
      revokedManifest as unknown as ContainerWriterProjectionResponse["path"][number],
    ],
    containerKeks: [
      {
        ...(rotatedKekState as unknown as ContainerWriterProjectionResponse["containerKeks"][number]),
        containerManifestHistory: [
          previousManifest as unknown as ContainerWriterProjectionResponse["path"][number],
        ],
        keyring,
      },
    ],
  };
  return {
    parent,
    previousContainerKek,
    resolveProjectionUserKey,
    revokedKeyPair,
    revokedManifest,
    revokedProjection,
    rotatedContainerKek,
    rotatedContainerKeyEpochId,
    rotatedKekState,
    verifiedRotatedKek,
  };
}

/** A document created in the rotated container, with its writer projection. */
export async function createDocumentAfterRevoke(
  execSql: TestExecSql,
  fixture: Awaited<ReturnType<typeof createRevokedRotationFixture>>,
) {
  const { parent, resolveProjectionUserKey, revokedProjection } = fixture;
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const createdDocumentId = "550e8400-e29b-41d4-a716-446655440700";
  const createdDocument = await buildMaterializedDocumentCreatePlan({
    author: parent.author,
    containerProjection: revokedProjection,
    contentKey,
    documentId: createdDocumentId,
    eventId: "document-after-revoke-event",
    execSql,
    resolveProjectionUserKey,
    signedAt: SIGNED_AT,
    targetSecretKey: parent.secretKey,
  });
  const documentWriterProjection: DocumentWriterProjectionResponse = {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    authorizingContainerPaths: [revokedProjection],
    contentKeyBundle: {
      documentId: createdDocument.plan.documentId,
      contentKeyEpoch:
        createdDocument.plan.request.contentKeyBundle.contentKeyEpoch,
      linkSetManifestHash:
        createdDocument.plan.request.contentKeyBundle.linkSetManifestHash,
      targetHash: createdDocument.plan.request.contentKeyBundle.targetHash,
      targets: [...createdDocument.plan.request.contentKeyBundle.targets],
    },
    documentContainerManifestHistory: [
      ...revokedProjection.path,
      ...revokedProjection.containerKeks.flatMap(
        (kek) => kek.containerManifestHistory,
      ),
    ],
    documentId: createdDocument.plan.documentId,
    documentKekTargets: {
      documentId: createdDocument.plan.documentId,
      linkSetManifestHash: createdDocument.plan.manifestHash,
      linkedContainerManifestHashes: createdDocument.plan.targets.map(
        (target) => target.containerManifestHash,
      ),
      linkedContainerKeyEpochIds: createdDocument.plan.targets.map(
        (target) => target.containerKeyEpochId,
      ),
      targets: createdDocument.plan.targets.map((target) => ({ ...target })),
      documentKeyTargetHash: createdDocument.plan.targetHash,
    },
    documentManifest: {
      event: {
        event: createdDocument.plan.event as unknown as Record<string, unknown>,
        body: createdDocument.plan.body as unknown as Record<string, unknown>,
        eventHash: createdDocument.plan.eventHash,
      },
      manifest: createdDocument.plan.manifest as unknown as Record<
        string,
        unknown
      >,
      manifestHash: createdDocument.plan.manifestHash,
      state: createdDocument.plan.state as unknown as Record<string, unknown>,
    },
    documentManifestContainerPaths: [[...revokedProjection.path]],
    documentManifestHistory: [],
  };
  return {
    contentKey,
    createdDocument,
    createdDocumentId,
    documentWriterProjection,
  };
}

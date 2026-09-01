import { computeDocumentContentKeyTargetHash } from "@tearleads/crypto";
import { createDocument, exportFullHistorySnapshot } from "@tearleads/loro";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createMaterializedSyncFixture,
  getOnlyTarget,
} from "./documentFixtures";

/**
 * Simulates a linked container KEK rotating beneath a stored content-key
 * bundle. The writer projection carries the old bundle marked stale while its
 * current KEK target points at the rotated container epoch.
 */
export async function createStaleBundleSyncFixture() {
  const fixture = await createMaterializedSyncFixture();
  const staleBundle = fixture.writerProjection.contentKeyBundle;
  const containerId = staleBundle.targets[0]?.containerId;
  if (!containerId) {
    throw new Error("Expected the fixture bundle to carry a container target");
  }
  const rotatedProjection = await createContainerWriterProjectionFixture({
    containerId,
    encapsulationPublicKey: fixture.publicKey,
    organizationId: fixture.author.organizationId,
    signerKeyFingerprint: fixture.author.signerKeyFingerprint,
    signerPrivateKey: fixture.author.signerPrivateKey,
    userId: fixture.author.signerUserId,
  });
  const derivedTarget = getOnlyTarget(rotatedProjection);
  const rotatedTarget = {
    containerId: derivedTarget.containerId,
    containerManifestHash: derivedTarget.containerManifestHash,
    containerKeyEpochId: derivedTarget.containerKeyEpochId,
    containerKeyEpoch: derivedTarget.containerKeyEpoch,
  };
  const staleWriterProjection: DocumentWriterProjectionResponse = {
    ...fixture.writerProjection,
    contentKeyBundleStale: true,
    documentKekTargets: {
      documentId: fixture.writerProjection.documentId,
      documentKeyTargetHash: await computeDocumentContentKeyTargetHash([
        rotatedTarget,
      ]),
      linkSetManifestHash:
        fixture.writerProjection.documentManifest.manifestHash,
      linkedContainerKeyEpochIds: [rotatedTarget.containerKeyEpochId],
      linkedContainerManifestHashes: [rotatedTarget.containerManifestHash],
      targets: [rotatedTarget],
    },
    authorizingContainerPaths: [rotatedProjection],
  };

  return { ...fixture, rotatedTarget, staleBundle, staleWriterProjection };
}

export async function createFullHistoryRotationSnapshot(): Promise<Uint8Array> {
  const doc = await createDocument("stale-heal-source");
  doc.getText("text").update("healed content");
  doc.commit();
  return exportFullHistorySnapshot(doc);
}

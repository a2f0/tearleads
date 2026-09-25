import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifests,
  attachmentBindings,
  containerKeyEpochs,
} from "@tearleads/api-shared/schema";
import { computeKeyingDomainHash } from "@tearleads/crypto";
import { containerWrappingPublicKeyForTest } from "@tearleads/crypto/test-fixtures";
import type { BlobContentKeyTargetEnvelope } from "../../src/access/read/blobContentKeyStore";
import type { resolveCurrentBlobKekTargets } from "../../src/access/read/blobKekTargets";
import { contentKeyEnvelopeFixture } from "./contentKeyEnvelope";

export async function hashOf(label: string): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.access-event-body", {
    label,
  });
}

export async function ensureContainerHead(input: {
  readonly containerId: string;
  readonly epoch?: number;
  readonly keyEpoch?: number;
  readonly keyEpochId?: string;
  readonly organizationId: string;
}) {
  const epoch = input.epoch ?? 1;
  const keyEpoch = input.keyEpoch ?? epoch;
  const label =
    epoch === 1 ? input.containerId : `${input.containerId}:epoch-${epoch}`;
  const manifestHash = await hashOf(`${label}:manifest`);
  const eventHash = await hashOf(`${label}:event`);
  const containerKeyEpochId =
    input.keyEpochId ?? `${input.containerId}:key-epoch-${keyEpoch}`;
  await db
    .insert(accessEvents)
    .values({
      version: 1,
      eventId: `${label}:event-id`,
      eventType: "container.create",
      objectKind: "container",
      objectId: input.containerId,
      organizationId: input.organizationId,
      previousManifestHash: null,
      dependencyManifestHashes: [],
      bodyHash: await hashOf(`${label}:body`),
      body: {},
      eventHash,
      signerUserId: crypto.randomUUID(),
      signerDeviceId: "device-1",
      signerKeyFingerprint: await hashOf(`${label}:signer`),
      signature: `${label}:signature`,
      signedAt: new Date(0),
    })
    .onConflictDoNothing({ target: accessEvents.eventHash });
  await db
    .insert(accessManifests)
    .values({
      version: 1,
      objectKind: "container",
      objectId: input.containerId,
      organizationId: input.organizationId,
      epoch,
      previousManifestHash: null,
      eventHash,
      structuralHash: await hashOf(`${label}:structural`),
      grantRoot: await hashOf(`${label}:grant-root`),
      referencedPrincipalHeads: [],
      keyTargetHash: await hashOf(`${label}:key-target`),
      manifestHash,
      state: {
        containerKeyPublicKey:
          containerWrappingPublicKeyForTest(containerKeyEpochId),
        systemSlot: null,
        version: 1,
        containerId: input.containerId,
        organizationId: input.organizationId,
        epoch,
        previousManifestHash: null,
        eventHash,
        parentContainerId: null,
        parentManifestHash: null,
        metadataDocumentId: `${input.containerId}:metadata`,
        containerKeyEpochId,
        directGrants: [],
        referencedPrincipalHeads: [],
      },
    })
    .onConflictDoNothing({ target: accessManifests.manifestHash });
  await db
    .insert(accessManifestHeads)
    .values({
      objectKind: "container",
      objectId: input.containerId,
      organizationId: input.organizationId,
      epoch,
      manifestHash,
    })
    .onConflictDoUpdate({
      target: [accessManifestHeads.objectKind, accessManifestHeads.objectId],
      set: {
        epoch,
        manifestHash,
        organizationId: input.organizationId,
        updatedAt: new Date(),
      },
    });
  await db
    .insert(containerKeyEpochs)
    .values({
      id: containerKeyEpochId,
      containerId: input.containerId,
      keyEpoch,
      accessManifestHash: manifestHash,
      parentContainerKeyEpochId: null,
      createdByEventHash: eventHash,
      createdByManifestHash: manifestHash,
    })
    .onConflictDoNothing({ target: containerKeyEpochs.id });

  return { containerKeyEpochId, manifestHash };
}

export async function setDocumentHead(input: {
  readonly documentId: string;
  readonly epoch: number;
  readonly linkedContainerIds: readonly string[];
  readonly organizationId: string;
}) {
  for (const containerId of input.linkedContainerIds) {
    await ensureContainerHead({
      containerId,
      organizationId: input.organizationId,
    });
  }

  const manifestHash = await hashOf(
    `${input.documentId}:manifest:${input.epoch}`,
  );
  await db
    .insert(accessManifestHeads)
    .values({
      objectKind: "document",
      objectId: input.documentId,
      organizationId: input.organizationId,
      epoch: input.epoch,
      manifestHash,
    })
    .onConflictDoUpdate({
      target: [accessManifestHeads.objectKind, accessManifestHeads.objectId],
      set: {
        organizationId: input.organizationId,
        epoch: input.epoch,
        manifestHash,
        updatedAt: new Date(),
      },
    });
  await db.insert(accessManifestDocumentLinkProjection).values(
    input.linkedContainerIds.map((containerId) => ({
      manifestHash,
      documentId: input.documentId,
      containerId,
    })),
  );

  return manifestHash;
}

export async function attachBlob(input: {
  readonly bindingId: string;
  readonly blobId: string;
  readonly documentId: string;
  readonly documentManifestHash: string;
  readonly slotId: string;
}) {
  await db.insert(attachmentBindings).values({
    id: input.bindingId,
    documentId: input.documentId,
    slotId: input.slotId,
    blobId: input.blobId,
    previousBindingId: null,
    attachmentEventHash: await hashOf(`${input.bindingId}:attachment-event`),
    documentManifestHash: input.documentManifestHash,
  });
}

export function targetEnvelopes(
  targets: Awaited<ReturnType<typeof resolveCurrentBlobKekTargets>>,
  suffix = "initial",
): BlobContentKeyTargetEnvelope[] {
  return targets.targets.map((target) => ({
    ...target,
    ...contentKeyEnvelopeFixture(
      "Blob",
      `${target.bindingId}:${target.containerId}:${suffix}`,
    ),
  }));
}

import { expect, test } from "bun:test";
import {
  type AccessEventTypeV2,
  type AccessManifestV2,
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeDocumentContentKeyTargetHash,
  computeKeyingV2DomainHash,
  deriveDocumentLinkSetManifest,
  generateSigningSeedAndKeyPair,
  type KeyingV2CanonicalJson,
  signAccessEvent,
  toFingerprint,
  type VerifiedAccessEvent,
  type VerifiedContainerAccessManifest,
  type VerifiedDocumentLinkSetManifest,
  verifyAccessManifest,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { db } from "../adapters/postgres";
import { containerKeyEpochs } from "../schema";
import { storeVerifiedAccessManifest } from "./accessManifestStore";
import {
  assertDocumentKekTargetsCurrent,
  DocumentKekTargetError,
  resolveCurrentDocumentKekTargets,
} from "./documentKekTargets";

async function hashOf(label: string): Promise<string> {
  return computeKeyingV2DomainHash("tearleads.keying-v2.access-event-body.v1", {
    label,
  });
}

async function createVerifiedEvent(input: {
  readonly body: Record<string, unknown>;
  readonly dependencyManifestHashes?: readonly string[];
  readonly eventType: AccessEventTypeV2;
  readonly objectId: string;
  readonly objectKind: "container" | "document";
  readonly organizationId: string;
  readonly previousManifestHash?: string | null;
}): Promise<VerifiedAccessEvent> {
  const signing = generateSigningSeedAndKeyPair();
  const event = await signAccessEvent(
    {
      version: 2,
      eventId: crypto.randomUUID(),
      eventType: input.eventType,
      objectKind: input.objectKind,
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: input.previousManifestHash ?? null,
      dependencyManifestHashes: [...(input.dependencyManifestHashes ?? [])],
      bodyHash: await computeAccessEventBodyHash(
        input.body as KeyingV2CanonicalJson,
      ),
      signerUserId: crypto.randomUUID(),
      signerDeviceId: "device-1",
      signerKeyFingerprint: await toFingerprint(signing.signingPublicKey),
      signedAt: new Date().toISOString(),
    },
    signing.signingPrivateKey,
  );
  const verifiedEvent = await verifySignedAccessEvent({
    body: input.body as KeyingV2CanonicalJson,
    event,
    signerPublicKey: signing.signingPublicKey,
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

async function createVerifiedContainerManifest(input: {
  readonly containerKeyEpochId?: string;
  readonly containerId: string;
  readonly epoch?: number;
  readonly organizationId: string;
  readonly previousManifestHash?: string | null;
  readonly salt: string;
}): Promise<VerifiedContainerAccessManifest> {
  const containerKeyEpochId =
    input.containerKeyEpochId ?? `${input.containerId}:key-epoch-1`;
  const event = await createVerifiedEvent({
    body: {
      containerKeyEpochId,
      eventType: "container.grant",
      grant: {
        accessLevel: "read",
        subjectId: crypto.randomUUID(),
        subjectType: "user",
      },
      referencedPrincipalHead: null,
      salt: input.salt,
    },
    eventType: "container.grant",
    objectKind: "container",
    objectId: input.containerId,
    organizationId: input.organizationId,
    previousManifestHash: input.previousManifestHash ?? null,
  });
  const manifest: AccessManifestV2 = {
    version: 2,
    objectKind: "container",
    objectId: input.containerId,
    organizationId: input.organizationId,
    epoch: input.epoch ?? 1,
    previousManifestHash: input.previousManifestHash ?? null,
    eventHash: event.eventHash,
    structuralHash: await hashOf(`${input.salt}:structural`),
    grantRoot: await hashOf(`${input.salt}:grant-root`),
    referencedPrincipalHeads: [],
    keyTargetHash: await hashOf(`${input.salt}:key-target`),
  };
  const verifiedManifest = await verifyAccessManifest({
    event,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    expectedObject: { objectKind: "container", objectId: input.containerId },
    expectedPreviousManifestHash: input.previousManifestHash ?? null,
    manifest,
  });

  if (!verifiedManifest.ok) {
    throw verifiedManifest.error;
  }

  return {
    ...verifiedManifest.value,
    state: {
      version: 2,
      containerId: input.containerId,
      organizationId: input.organizationId,
      epoch: input.epoch ?? 1,
      previousManifestHash: input.previousManifestHash ?? null,
      eventHash: event.eventHash,
      parentContainerId: null,
      parentManifestHash: null,
      metadataDocumentId: `${input.containerId}:metadata`,
      containerKeyEpochId,
      directGrants: [],
      referencedPrincipalHeads: [],
    },
  } as unknown as VerifiedContainerAccessManifest;
}

async function createVerifiedDocumentLinkSetManifest(input: {
  readonly containerManifestHashes: readonly string[];
  readonly documentId: string;
  readonly linkedContainerIds: readonly string[];
  readonly organizationId: string;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const event = await createVerifiedEvent({
    body: {
      eventType: "document.link",
      containerId: input.linkedContainerIds[0],
      containerManifestHash: input.containerManifestHashes[0],
    },
    dependencyManifestHashes: input.containerManifestHashes,
    eventType: "document.link",
    objectKind: "document",
    objectId: input.documentId,
    organizationId: input.organizationId,
  });
  const state = {
    version: 2 as const,
    documentId: input.documentId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
    linkedContainerIds: [...input.linkedContainerIds].sort(),
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const verifiedManifest = await verifyAccessManifest({
    event,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    expectedObject: { objectKind: "document", objectId: input.documentId },
    expectedPreviousManifestHash: null,
    manifest,
  });

  if (!verifiedManifest.ok) {
    throw verifiedManifest.error;
  }

  return {
    ...verifiedManifest.value,
    state,
  } as unknown as VerifiedDocumentLinkSetManifest;
}

async function insertContainerKeyEpoch(input: {
  readonly containerId: string;
  readonly keyEpoch?: number;
  readonly keyEpochId: string;
  readonly manifestHash: string;
}) {
  await db.insert(containerKeyEpochs).values({
    id: input.keyEpochId,
    containerId: input.containerId,
    keyEpoch: input.keyEpoch ?? 1,
    accessManifestHash: input.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: await hashOf(`${input.keyEpochId}:event`),
    createdByManifestHash: input.manifestHash,
  });
}

test("resolveCurrentDocumentKekTargets derives targets from linked container heads", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const firstContainerId = crypto.randomUUID();
  const secondContainerId = crypto.randomUUID();
  const firstContainer = await createVerifiedContainerManifest({
    containerId: firstContainerId,
    organizationId,
    salt: "first",
  });
  const secondContainer = await createVerifiedContainerManifest({
    containerId: secondContainerId,
    organizationId,
    salt: "second",
  });
  await storeVerifiedAccessManifest({ verifiedManifest: firstContainer });
  await storeVerifiedAccessManifest({ verifiedManifest: secondContainer });
  await insertContainerKeyEpoch({
    containerId: firstContainerId,
    keyEpochId: `${firstContainerId}:key-epoch-1`,
    manifestHash: firstContainer.manifestHash,
  });
  await insertContainerKeyEpoch({
    containerId: secondContainerId,
    keyEpochId: `${secondContainerId}:key-epoch-1`,
    manifestHash: secondContainer.manifestHash,
  });
  const documentManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [
      firstContainer.manifestHash,
      secondContainer.manifestHash,
    ],
    documentId,
    linkedContainerIds: [secondContainerId, firstContainerId],
    organizationId,
  });
  await storeVerifiedAccessManifest({
    verifiedManifest: documentManifest,
  });

  const targets = await resolveCurrentDocumentKekTargets(documentId);
  const expectedTargets = [
    {
      containerId: firstContainerId,
      containerManifestHash: firstContainer.manifestHash,
      containerKeyEpochId: `${firstContainerId}:key-epoch-1`,
      containerKeyEpoch: 1,
    },
    {
      containerId: secondContainerId,
      containerManifestHash: secondContainer.manifestHash,
      containerKeyEpochId: `${secondContainerId}:key-epoch-1`,
      containerKeyEpoch: 1,
    },
  ].sort((left, right) => left.containerId.localeCompare(right.containerId));

  expect(targets.linkSetManifestHash).toBe(documentManifest.manifestHash);
  expect(targets.targets).toEqual(expectedTargets);
  expect(targets.documentKeyTargetHash).toBe(
    await computeDocumentContentKeyTargetHash(targets.targets),
  );
});

test("resolveCurrentDocumentKekTargets uses the container manifest key epoch", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const container = await createVerifiedContainerManifest({
    containerId,
    organizationId,
    salt: "manifest-key-epoch",
  });
  const manifestKeyEpochId = `${containerId}:key-epoch-1`;
  await storeVerifiedAccessManifest({ verifiedManifest: container });
  await insertContainerKeyEpoch({
    containerId,
    keyEpochId: manifestKeyEpochId,
    manifestHash: container.manifestHash,
  });
  await insertContainerKeyEpoch({
    containerId,
    keyEpoch: 2,
    keyEpochId: `${containerId}:unreferenced-key-epoch-2`,
    manifestHash: container.manifestHash,
  });
  const documentManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [container.manifestHash],
    documentId,
    linkedContainerIds: [containerId],
    organizationId,
  });
  await storeVerifiedAccessManifest({
    verifiedManifest: documentManifest,
  });

  const targets = await resolveCurrentDocumentKekTargets(documentId);

  expect(targets.targets).toEqual([
    {
      containerId,
      containerManifestHash: container.manifestHash,
      containerKeyEpochId: manifestKeyEpochId,
      containerKeyEpoch: 1,
    },
  ]);
});

test("assertDocumentKekTargetsCurrent rejects stale target hashes", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const firstContainerManifest = await createVerifiedContainerManifest({
    containerId,
    organizationId,
    salt: "initial",
  });
  await storeVerifiedAccessManifest({
    verifiedManifest: firstContainerManifest,
  });
  await insertContainerKeyEpoch({
    containerId,
    keyEpochId: `${containerId}:key-epoch-1`,
    manifestHash: firstContainerManifest.manifestHash,
  });
  const documentManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [firstContainerManifest.manifestHash],
    documentId,
    linkedContainerIds: [containerId],
    organizationId,
  });
  await storeVerifiedAccessManifest({
    verifiedManifest: documentManifest,
  });
  const oldTargets = await resolveCurrentDocumentKekTargets(documentId);
  const nextContainerManifest = await createVerifiedContainerManifest({
    containerId,
    epoch: 2,
    organizationId,
    previousManifestHash: firstContainerManifest.manifestHash,
    salt: "next",
  });
  await storeVerifiedAccessManifest({
    verifiedManifest: nextContainerManifest,
  });

  await expect(
    assertDocumentKekTargetsCurrent({
      documentId,
      expectedTargetHash: oldTargets.documentKeyTargetHash,
    }),
  ).rejects.toMatchObject(
    new DocumentKekTargetError("Document KEK targets are stale", 409),
  );
});

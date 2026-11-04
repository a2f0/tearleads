import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifests,
  containerKeyEpochs,
} from "@tearleads/api-shared/schema";
import {
  type AccessEventType,
  type AccessManifest,
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeKeyingDomainHash,
  deriveDocumentLinkSetManifest,
  generateSigningSeedAndKeyPair,
  type KeyingCanonicalJson,
  signAccessEvent,
  toFingerprint,
  type VerifiedAccessEvent,
  type VerifiedContainerAccessManifest,
  type VerifiedDocumentLinkSetManifest,
  verifyAccessManifest,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { containerWrappingPublicKeyForTest } from "@tearleads/crypto/test-fixtures";
import { eq } from "drizzle-orm";
import type { DocumentContentKeyTargetEnvelope } from "../../src/access/read/documentContentKeyStore";
import type { resolveCurrentDocumentKekTargets } from "../../src/access/read/documentKekTargets";
import { storeVerifiedAccessManifest } from "../../src/access/write/accessManifestStore";
import { contentKeyEnvelopeFixture } from "./contentKeyEnvelope";

export async function hashOf(label: string): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.access-event-body", {
    label,
  });
}

async function createVerifiedEvent(input: {
  readonly body: Record<string, unknown>;
  readonly dependencyManifestHashes?: readonly string[];
  readonly eventType: AccessEventType;
  readonly objectId: string;
  readonly objectKind: "container" | "document";
  readonly organizationId: string;
  readonly previousManifestHash?: string | null;
}): Promise<VerifiedAccessEvent> {
  const signing = generateSigningSeedAndKeyPair();
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: input.eventType,
      objectKind: input.objectKind,
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: input.previousManifestHash ?? null,
      dependencyManifestHashes: [...(input.dependencyManifestHashes ?? [])],
      bodyHash: await computeAccessEventBodyHash(
        input.body as KeyingCanonicalJson,
      ),
      signerUserId: crypto.randomUUID(),
      signerDeviceId: "device-1",
      signerKeyFingerprint: await toFingerprint(signing.signingPublicKey),
      signedAt: new Date().toISOString(),
    },
    signing.signingPrivateKey,
  );
  const verifiedEvent = await verifySignedAccessEvent({
    body: input.body as KeyingCanonicalJson,
    event,
    signerPublicKey: signing.signingPublicKey,
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

export async function createVerifiedContainerManifest(input: {
  readonly containerKeyEpochId?: string;
  readonly containerId: string;
  readonly eventType?: Extract<
    AccessEventType,
    "container.grant" | "container.move" | "container.rekey"
  >;
  readonly epoch?: number;
  readonly organizationId: string;
  readonly parentContainerId?: string | null;
  readonly parentManifestHash?: string | null;
  readonly previousManifestHash?: string | null;
  readonly salt: string;
}): Promise<VerifiedContainerAccessManifest> {
  const containerKeyEpochId =
    input.containerKeyEpochId ?? `${input.containerId}:key-epoch-1`;
  const eventType = input.eventType ?? "container.grant";
  const body =
    eventType === "container.move"
      ? {
          containerKeyEpochId,
          eventType,
          parentContainerId: input.parentContainerId,
          parentManifestHash: input.parentManifestHash,
        }
      : eventType === "container.rekey"
        ? {
            containerKeyEpochId,
            eventType,
          }
        : {
            containerKeyEpochId,
            eventType,
            grant: {
              accessLevel: "read",
              subjectId: crypto.randomUUID(),
              subjectType: "user",
            },
            referencedPrincipalHead: null,
            salt: input.salt,
          };
  const event = await createVerifiedEvent({
    body,
    eventType,
    objectKind: "container",
    objectId: input.containerId,
    organizationId: input.organizationId,
    previousManifestHash: input.previousManifestHash ?? null,
  });
  const manifest: AccessManifest = {
    version: 1,
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
      containerKeyPublicKey:
        containerWrappingPublicKeyForTest(containerKeyEpochId),
      systemSlot: null,
      version: 1,
      containerId: input.containerId,
      organizationId: input.organizationId,
      epoch: input.epoch ?? 1,
      previousManifestHash: input.previousManifestHash ?? null,
      eventHash: event.eventHash,
      parentContainerId: input.parentContainerId ?? null,
      parentManifestHash: input.parentManifestHash ?? null,
      metadataDocumentId: `${input.containerId}:metadata`,
      containerKeyEpochId,
      directGrants: [],
      referencedPrincipalHeads: [],
    },
  } as unknown as VerifiedContainerAccessManifest;
}

export async function createVerifiedDocumentLinkSetManifest(input: {
  readonly containerManifestHashes: readonly string[];
  readonly documentId: string;
  readonly epoch?: number;
  readonly linkedContainerIds: readonly string[];
  readonly organizationId: string;
  readonly previousManifestHash?: string | null;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const event = await createVerifiedEvent({
    body: {
      blobRewraps: [],
      eventType: "document.link",
      containerId: input.linkedContainerIds[0],
      containerManifestHash: input.containerManifestHashes[0],
    },
    dependencyManifestHashes: input.containerManifestHashes,
    eventType: "document.link",
    objectKind: "document",
    objectId: input.documentId,
    organizationId: input.organizationId,
    previousManifestHash: input.previousManifestHash ?? null,
  });
  const state = {
    version: 1 as const,
    documentId: input.documentId,
    organizationId: input.organizationId,
    epoch: input.epoch ?? 1,
    previousManifestHash: input.previousManifestHash ?? null,
    eventHash: event.eventHash,
    linkedContainerIds: [...input.linkedContainerIds].sort(),
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const verifiedManifest = await verifyAccessManifest({
    event,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    expectedObject: { objectKind: "document", objectId: input.documentId },
    expectedPreviousManifestHash: input.previousManifestHash ?? null,
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

export async function insertContainerKeyEpoch(input: {
  readonly containerId: string;
  readonly keyEpoch?: number;
  readonly keyEpochId: string;
  readonly manifestHash: string;
  readonly parentContainerKeyEpochId?: string | null;
}) {
  const [manifest] = await db
    .select({ eventHash: accessManifests.eventHash })
    .from(accessManifests)
    .where(eq(accessManifests.manifestHash, input.manifestHash))
    .limit(1);

  if (!manifest) {
    throw new Error("Expected stored access manifest for key epoch");
  }

  await db.insert(containerKeyEpochs).values({
    id: input.keyEpochId,
    containerId: input.containerId,
    keyEpoch: input.keyEpoch ?? 1,
    accessManifestHash: input.manifestHash,
    parentContainerKeyEpochId: input.parentContainerKeyEpochId ?? null,
    createdByEventHash: manifest.eventHash,
    createdByManifestHash: input.manifestHash,
  });
}

export function targetEnvelopes(
  targets: Awaited<ReturnType<typeof resolveCurrentDocumentKekTargets>>,
  suffix = "initial",
): DocumentContentKeyTargetEnvelope[] {
  return targets.targets.map((target) => ({
    ...target,
    ...contentKeyEnvelopeFixture("Document", `${target.containerId}:${suffix}`),
  }));
}

export async function setupDocumentTargets(linkedContainerCount: 1 | 2) {
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

  await storeVerifiedAccessManifest({ verifiedManifest: firstContainer }, db);
  await storeVerifiedAccessManifest({ verifiedManifest: secondContainer }, db);
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

  const linkedContainerIds =
    linkedContainerCount === 1
      ? [firstContainerId]
      : [firstContainerId, secondContainerId];
  const containerManifestHashes =
    linkedContainerCount === 1
      ? [firstContainer.manifestHash]
      : [firstContainer.manifestHash, secondContainer.manifestHash];
  const documentManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes,
    documentId,
    linkedContainerIds,
    organizationId,
  });
  await storeVerifiedAccessManifest({ verifiedManifest: documentManifest }, db);

  return {
    documentId,
    firstContainer,
    firstContainerId,
    organizationId,
    secondContainer,
    secondContainerId,
    documentManifest,
  };
}

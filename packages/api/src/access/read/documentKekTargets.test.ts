import { expect, test } from "bun:test";
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
  computeDocumentContentKeyTargetHash,
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
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { storeVerifiedAccessManifest } from "../write/accessManifestStore";
import {
  assertDocumentKekTargetsCurrent,
  DocumentKekTargetError,
  resolveCurrentDocumentKekTargets,
} from "./documentKekTargets";

async function hashOf(label: string): Promise<string> {
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

async function createVerifiedContainerManifest(input: {
  readonly containerKeyEpochId?: string;
  readonly containerId: string;
  readonly epoch?: number;
  readonly organizationId: string;
  readonly parentContainerId?: string | null;
  readonly parentManifestHash?: string | null;
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
    version: 1 as const,
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
  const documentManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [
      firstContainer.manifestHash,
      secondContainer.manifestHash,
    ],
    documentId,
    linkedContainerIds: [secondContainerId, firstContainerId],
    organizationId,
  });
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: documentManifest,
    },
    db,
  );

  const targets = await resolveCurrentDocumentKekTargets(documentId, db);
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
  await storeVerifiedAccessManifest({ verifiedManifest: container }, db);
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
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: documentManifest,
    },
    db,
  );

  const targets = await resolveCurrentDocumentKekTargets(documentId, db);

  expect(targets.targets).toEqual([
    {
      containerId,
      containerManifestHash: container.manifestHash,
      containerKeyEpochId: manifestKeyEpochId,
      containerKeyEpoch: 1,
    },
  ]);
});

test("resolveCurrentDocumentKekTargets rejects key epochs bound outside current same-epoch history", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const initialKeyEpochId = `${containerId}:key-epoch-1`;
  const currentKeyEpochId = `${containerId}:key-epoch-2`;
  const initialContainer = await createVerifiedContainerManifest({
    containerId,
    containerKeyEpochId: initialKeyEpochId,
    organizationId,
    salt: "initial-key-epoch",
  });
  const currentContainer = await createVerifiedContainerManifest({
    containerId,
    containerKeyEpochId: currentKeyEpochId,
    epoch: 2,
    organizationId,
    previousManifestHash: initialContainer.manifestHash,
    salt: "current-key-epoch",
  });
  await storeVerifiedAccessManifest({ verifiedManifest: initialContainer }, db);
  await storeVerifiedAccessManifest({ verifiedManifest: currentContainer }, db);
  await insertContainerKeyEpoch({
    containerId,
    keyEpoch: 2,
    keyEpochId: currentKeyEpochId,
    manifestHash: initialContainer.manifestHash,
  });
  const documentManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [currentContainer.manifestHash],
    documentId,
    linkedContainerIds: [containerId],
    organizationId,
  });
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: documentManifest,
    },
    db,
  );

  await expect(
    resolveCurrentDocumentKekTargets(documentId, db),
  ).rejects.toEqual(
    new DocumentKekTargetError(
      `Container KEK epoch is stale for container ${containerId}`,
      409,
    ),
  );
});

test("resolveCurrentDocumentKekTargets rejects linked containers with stale parent KEK edges", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const rootContainerId = crypto.randomUUID();
  const childContainerId = crypto.randomUUID();
  const rootKeyEpochId = `${rootContainerId}:key-epoch-1`;
  const childKeyEpochId = `${childContainerId}:key-epoch-1`;
  const root = await createVerifiedContainerManifest({
    containerId: rootContainerId,
    containerKeyEpochId: rootKeyEpochId,
    organizationId,
    salt: "root",
  });
  const child = await createVerifiedContainerManifest({
    containerId: childContainerId,
    containerKeyEpochId: childKeyEpochId,
    organizationId,
    parentContainerId: rootContainerId,
    parentManifestHash: root.manifestHash,
    salt: "child",
  });
  await storeVerifiedAccessManifest({ verifiedManifest: root }, db);
  await storeVerifiedAccessManifest({ verifiedManifest: child }, db);
  await insertContainerKeyEpoch({
    containerId: rootContainerId,
    keyEpochId: rootKeyEpochId,
    manifestHash: root.manifestHash,
  });
  await insertContainerKeyEpoch({
    containerId: childContainerId,
    keyEpochId: childKeyEpochId,
    manifestHash: child.manifestHash,
    parentContainerKeyEpochId: rootKeyEpochId,
  });
  const documentManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [child.manifestHash],
    documentId,
    linkedContainerIds: [childContainerId],
    organizationId,
  });
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: documentManifest,
    },
    db,
  );

  await expect(
    resolveCurrentDocumentKekTargets(documentId, db),
  ).resolves.toEqual(
    expect.objectContaining({
      linkedContainerKeyEpochIds: [childKeyEpochId],
    }),
  );

  const rotatedRootKeyEpochId = `${rootContainerId}:key-epoch-2`;
  const rotatedRoot = await createVerifiedContainerManifest({
    containerId: rootContainerId,
    containerKeyEpochId: rotatedRootKeyEpochId,
    epoch: 2,
    organizationId,
    previousManifestHash: root.manifestHash,
    salt: "root-rotated",
  });
  await storeVerifiedAccessManifest({ verifiedManifest: rotatedRoot }, db);
  await insertContainerKeyEpoch({
    containerId: rootContainerId,
    keyEpoch: 2,
    keyEpochId: rotatedRootKeyEpochId,
    manifestHash: rotatedRoot.manifestHash,
  });

  await expect(
    resolveCurrentDocumentKekTargets(documentId, db),
  ).rejects.toEqual(
    new DocumentKekTargetError(
      `Container KEK parent edge is stale for container ${childContainerId}`,
      409,
    ),
  );

  const rotatedChildKeyEpochId = `${childContainerId}:key-epoch-2`;
  const rotatedChild = await createVerifiedContainerManifest({
    containerId: childContainerId,
    containerKeyEpochId: rotatedChildKeyEpochId,
    epoch: 2,
    organizationId,
    parentContainerId: rootContainerId,
    parentManifestHash: rotatedRoot.manifestHash,
    previousManifestHash: child.manifestHash,
    salt: "child-rotated",
  });
  await storeVerifiedAccessManifest({ verifiedManifest: rotatedChild }, db);
  await insertContainerKeyEpoch({
    containerId: childContainerId,
    keyEpoch: 2,
    keyEpochId: rotatedChildKeyEpochId,
    manifestHash: rotatedChild.manifestHash,
    parentContainerKeyEpochId: rotatedRootKeyEpochId,
  });

  await expect(
    resolveCurrentDocumentKekTargets(documentId, db),
  ).resolves.toEqual(
    expect.objectContaining({
      linkedContainerKeyEpochIds: [rotatedChildKeyEpochId],
    }),
  );
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
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: firstContainerManifest,
    },
    db,
  );
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
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: documentManifest,
    },
    db,
  );
  const oldTargets = await resolveCurrentDocumentKekTargets(documentId, db);
  const nextContainerManifest = await createVerifiedContainerManifest({
    containerId,
    epoch: 2,
    organizationId,
    previousManifestHash: firstContainerManifest.manifestHash,
    salt: "next",
  });
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: nextContainerManifest,
    },
    db,
  );

  await expect(
    assertDocumentKekTargetsCurrent(
      {
        documentId,
        expectedTargetHash: oldTargets.documentKeyTargetHash,
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentKekTargetError(
      "Document KEK targets are stale",
      409,
      DOCUMENT_SYNC_ERROR_CODES.stateStale,
    ),
  );
});

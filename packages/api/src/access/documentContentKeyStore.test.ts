import { expect, test } from "bun:test";
import {
  type AccessEventTypeV2,
  type AccessManifestV2,
  CONTENT_RECORD_ENCRYPTION_SUITE_V2,
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeContentRecordNonceDomainHash,
  computeDocumentContentKeyTargetHash,
  computeKeyingV2DomainHash,
  deriveDocumentLinkSetManifest,
  generateSigningSeedAndKeyPair,
  type KeyingV2CanonicalJson,
  signAccessEvent,
  toFingerprint,
  type VerifiedAccessEvent,
  type VerifiedAccessManifest,
  type VerifiedDocumentLinkSetManifest,
  verifyAccessManifest,
  verifySignedAccessEvent,
  type WriteHeaderV2,
} from "@tearleads/crypto";
import { db } from "../adapters/postgres";
import { containerKeyEpochs } from "../schema";
import { storeVerifiedAccessManifest } from "./accessManifestStore";
import {
  DocumentContentKeyBundleError,
  type DocumentContentKeyTargetEnvelope,
  listDocumentContentWriteHeaders,
  storeDocumentContentKeyBundle,
  storeDocumentContentWriteHeader,
} from "./documentContentKeyStore";
import { resolveCurrentDocumentKekTargets } from "./documentKekTargets";

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
  readonly containerId: string;
  readonly epoch?: number;
  readonly organizationId: string;
  readonly previousManifestHash?: string | null;
  readonly salt: string;
}): Promise<VerifiedAccessManifest> {
  const event = await createVerifiedEvent({
    body: {
      containerKeyEpochId: `${input.containerId}-key-epoch-${input.epoch ?? 1}`,
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

  return verifiedManifest.value;
}

async function createVerifiedDocumentLinkSetManifest(input: {
  readonly containerManifestHashes: readonly string[];
  readonly documentId: string;
  readonly epoch?: number;
  readonly linkedContainerIds: readonly string[];
  readonly organizationId: string;
  readonly previousManifestHash?: string | null;
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
    previousManifestHash: input.previousManifestHash ?? null,
  });
  const state = {
    version: 2 as const,
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

async function insertContainerKeyEpoch(input: {
  readonly containerId: string;
  readonly keyEpochId: string;
  readonly manifestHash: string;
}) {
  await db.insert(containerKeyEpochs).values({
    id: input.keyEpochId,
    containerId: input.containerId,
    keyEpoch: 1,
    accessManifestHash: input.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: await hashOf(`${input.keyEpochId}:event`),
    createdByManifestHash: input.manifestHash,
  });
}

function targetEnvelopes(
  targets: Awaited<ReturnType<typeof resolveCurrentDocumentKekTargets>>,
  suffix = "initial",
): DocumentContentKeyTargetEnvelope[] {
  return targets.targets.map((target) => ({
    ...target,
    wrappedKey: `${target.containerId}:${suffix}`,
    wrappingMetadata: { suite: "test-wrap" },
  }));
}

async function setupDocumentTargets(linkedContainerCount: 1 | 2) {
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
  await storeVerifiedAccessManifest({ verifiedManifest: documentManifest });

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

test("storeDocumentContentKeyBundle stores one canonical bundle for current targets", async () => {
  const { documentId } = await setupDocumentTargets(2);
  const currentTargets = await resolveCurrentDocumentKekTargets(documentId);
  const envelopes = targetEnvelopes(currentTargets);
  const stored = await storeDocumentContentKeyBundle({
    documentId,
    contentKeyEpoch: 1,
    linkSetManifestHash: currentTargets.linkSetManifestHash,
    targetHash: currentTargets.documentKeyTargetHash,
    targets: envelopes,
  });

  expect(stored.targets).toEqual(envelopes);

  await expect(
    storeDocumentContentKeyBundle({
      documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: currentTargets.linkSetManifestHash,
      targetHash: currentTargets.documentKeyTargetHash,
      targets: targetEnvelopes(currentTargets, "different-material"),
    }),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document content-key bundle conflict",
      409,
    ),
  );
});

test("storeDocumentContentKeyBundle rejects missing extra duplicate and stale targets", async () => {
  const { documentId } = await setupDocumentTargets(2);
  const currentTargets = await resolveCurrentDocumentKekTargets(documentId);
  const envelopes = targetEnvelopes(currentTargets);
  const firstEnvelope = envelopes[0];
  if (!firstEnvelope) {
    throw new Error("Expected at least one document content-key target");
  }
  const missingTarget = envelopes.slice(0, 1);
  const extraTarget = [
    ...envelopes,
    {
      ...firstEnvelope,
      containerId: crypto.randomUUID(),
      wrappedKey: "extra",
    },
  ];
  const duplicateTarget = [...envelopes, { ...firstEnvelope }];
  const staleTargetHash = await computeDocumentContentKeyTargetHash(
    currentTargets.targets.slice(0, 1),
  );

  for (const targets of [missingTarget, extraTarget, duplicateTarget]) {
    await expect(
      storeDocumentContentKeyBundle({
        documentId,
        contentKeyEpoch: 1,
        linkSetManifestHash: currentTargets.linkSetManifestHash,
        targetHash: currentTargets.documentKeyTargetHash,
        targets,
      }),
    ).rejects.toBeInstanceOf(DocumentContentKeyBundleError);
  }

  await expect(
    storeDocumentContentKeyBundle({
      documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: currentTargets.linkSetManifestHash,
      targetHash: staleTargetHash,
      targets: missingTarget,
    }),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError("Document KEK targets are stale", 409),
  );
});

test("storeDocumentContentKeyBundle allows additive target growth on the same content key epoch", async () => {
  const setup = await setupDocumentTargets(1);
  const initialTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
  );
  const initialEnvelopes = targetEnvelopes(initialTargets);
  await storeDocumentContentKeyBundle({
    documentId: setup.documentId,
    contentKeyEpoch: 1,
    linkSetManifestHash: initialTargets.linkSetManifestHash,
    targetHash: initialTargets.documentKeyTargetHash,
    targets: initialEnvelopes,
  });
  const expandedManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [
      setup.firstContainer.manifestHash,
      setup.secondContainer.manifestHash,
    ],
    documentId: setup.documentId,
    epoch: 2,
    linkedContainerIds: [setup.firstContainerId, setup.secondContainerId],
    organizationId: setup.organizationId,
    previousManifestHash: setup.documentManifest.manifestHash,
  });
  await storeVerifiedAccessManifest({ verifiedManifest: expandedManifest });
  const expandedTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
  );
  const expandedEnvelopes = expandedTargets.targets.map((target) => {
    const existing = initialEnvelopes.find(
      (envelope) => envelope.containerId === target.containerId,
    );
    return (
      existing ?? {
        ...target,
        wrappedKey: `${target.containerId}:expanded`,
        wrappingMetadata: { suite: "test-wrap" },
      }
    );
  });

  const stored = await storeDocumentContentKeyBundle({
    documentId: setup.documentId,
    contentKeyEpoch: 1,
    linkSetManifestHash: expandedTargets.linkSetManifestHash,
    targetHash: expandedTargets.documentKeyTargetHash,
    targets: expandedEnvelopes,
  });

  expect(stored.contentKeyEpoch).toBe(1);
  expect(stored.targets).toEqual(expandedEnvelopes);
});

test("storeDocumentContentKeyBundle requires a new content key epoch after target shrink", async () => {
  const setup = await setupDocumentTargets(2);
  const initialTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
  );
  await storeDocumentContentKeyBundle({
    documentId: setup.documentId,
    contentKeyEpoch: 1,
    linkSetManifestHash: initialTargets.linkSetManifestHash,
    targetHash: initialTargets.documentKeyTargetHash,
    targets: targetEnvelopes(initialTargets),
  });
  const shrunkManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [setup.firstContainer.manifestHash],
    documentId: setup.documentId,
    epoch: 2,
    linkedContainerIds: [setup.firstContainerId],
    organizationId: setup.organizationId,
    previousManifestHash: setup.documentManifest.manifestHash,
  });
  await storeVerifiedAccessManifest({ verifiedManifest: shrunkManifest });
  const shrunkTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
  );
  const shrunkEnvelopes = targetEnvelopes(shrunkTargets, "rotated");

  await expect(
    storeDocumentContentKeyBundle({
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: shrunkTargets.linkSetManifestHash,
      targetHash: shrunkTargets.documentKeyTargetHash,
      targets: shrunkEnvelopes,
    }),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document content key epoch must rotate after target shrink",
      409,
    ),
  );

  await expect(
    storeDocumentContentKeyBundle({
      documentId: setup.documentId,
      contentKeyEpoch: 2,
      linkSetManifestHash: shrunkTargets.linkSetManifestHash,
      targetHash: shrunkTargets.documentKeyTargetHash,
      targets: shrunkEnvelopes,
    }),
  ).resolves.toMatchObject({
    contentKeyEpoch: 2,
    targets: shrunkEnvelopes,
  });
});

test("storeDocumentContentWriteHeader stores canonical headers by update id", async () => {
  const updateId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const contentRecordId = "33333333-3333-4333-8333-333333333333";
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 2,
    organizationId,
    objectKind: "document",
    objectId: documentId,
    contentKeyEpoch: 1,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
    contentRecordId,
  });
  const header: WriteHeaderV2 = {
    version: 2,
    organizationId,
    objectKind: "document",
    objectId: documentId,
    accessManifestHash: await hashOf("write-header-manifest"),
    contentKeyEpoch: 1,
    targetHash: await hashOf("write-header-targets"),
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
    contentRecordId,
    nonceDomainHash,
    metadataHash: await hashOf("write-header-metadata"),
    ciphertextHash: await hashOf("write-header-ciphertext"),
    writerUserId: crypto.randomUUID(),
    writerDeviceId: "device-1",
    writerKeyFingerprint: await hashOf("write-header-writer"),
    signedAt: new Date().toISOString(),
    signature: "signature",
  };
  const headerHash = await hashOf("write-header");

  await storeDocumentContentWriteHeader({
    documentId,
    header,
    headerHash,
    updateId,
  });
  await storeDocumentContentWriteHeader({
    documentId,
    header,
    headerHash,
    updateId,
  });

  await expect(
    storeDocumentContentWriteHeader({
      documentId,
      header,
      headerHash: await hashOf("write-header-conflict"),
      updateId,
    }),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError("Document write header conflict", 409),
  );
  await expect(
    storeDocumentContentWriteHeader({
      documentId,
      header,
      headerHash,
      updateId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError("Document write header conflict", 409),
  );

  expect(await listDocumentContentWriteHeaders([updateId])).toEqual(
    new Map([[updateId, { header, headerHash }]]),
  );
});

test("storeDocumentContentWriteHeader rejects reused content record domains", async () => {
  const documentId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const contentRecordId = "44444444-4444-4444-8444-444444444444";
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 2,
    organizationId,
    objectKind: "document",
    objectId: documentId,
    contentKeyEpoch: 1,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
    contentRecordId,
  });
  const header: WriteHeaderV2 = {
    version: 2,
    organizationId,
    objectKind: "document",
    objectId: documentId,
    accessManifestHash: await hashOf("record-domain-manifest"),
    contentKeyEpoch: 1,
    targetHash: await hashOf("record-domain-targets"),
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
    contentRecordId,
    nonceDomainHash,
    metadataHash: await hashOf("record-domain-metadata"),
    ciphertextHash: await hashOf("record-domain-ciphertext"),
    writerUserId: crypto.randomUUID(),
    writerDeviceId: "device-1",
    writerKeyFingerprint: await hashOf("record-domain-writer"),
    signedAt: new Date().toISOString(),
    signature: "signature",
  };

  await storeDocumentContentWriteHeader({
    documentId,
    header,
    headerHash: await hashOf("record-domain-header"),
    updateId: crypto.randomUUID(),
  });

  await expect(
    storeDocumentContentWriteHeader({
      documentId,
      header: {
        ...header,
        metadataHash: await hashOf("duplicate-record-metadata"),
        ciphertextHash: await hashOf("duplicate-record-ciphertext"),
        signature: "signature-2",
      },
      headerHash: await hashOf("duplicate-record-header"),
      updateId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError("Document write header conflict", 409),
  );

  await expect(
    storeDocumentContentWriteHeader({
      documentId,
      header: {
        ...header,
        contentRecordId: "55555555-5555-4555-8555-555555555555",
        metadataHash: await hashOf("duplicate-domain-metadata"),
        ciphertextHash: await hashOf("duplicate-domain-ciphertext"),
        signature: "signature-3",
      },
      headerHash: await hashOf("duplicate-domain-header"),
      updateId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError("Document write header conflict", 409),
  );
});

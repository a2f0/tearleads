import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifests,
  containerKeyEpochs,
} from "@tearleads/api-shared/schema";
import {
  type AccessEventType,
  type AccessManifest,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeContentRecordNonceDomainHash,
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
  type WriteHeader,
} from "@tearleads/crypto";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  type DocumentContentKeyTargetEnvelope,
  getLatestCurrentDocumentContentKeyBundle,
  listDocumentContentWriteHeaders,
} from "../read/documentContentKeyStore";
import { resolveCurrentDocumentKekTargets } from "../read/documentKekTargets";
import { storeVerifiedAccessManifest } from "./accessManifestStore";
import {
  DocumentContentKeyBundleError,
  requireAndRefreshCurrentDocumentContentKeyBundle,
  storeDocumentContentKeyBundle,
  storeDocumentContentWriteHeader,
} from "./documentContentKeyStore";

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

test("storeDocumentContentKeyBundle stores one canonical bundle for current targets", async () => {
  const { documentId } = await setupDocumentTargets(2);
  const currentTargets = await resolveCurrentDocumentKekTargets(documentId, db);
  const envelopes = targetEnvelopes(currentTargets);
  const stored = await storeDocumentContentKeyBundle(
    {
      documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: currentTargets.linkSetManifestHash,
      targetHash: currentTargets.documentKeyTargetHash,
      targets: envelopes,
    },
    db,
  );

  expect(stored.targets).toEqual(envelopes);
  expect(stored.currentTargets.documentKeyTargetHash).toBe(
    currentTargets.documentKeyTargetHash,
  );
  expect(stored.currentTargets.linkSetManifestHash).toBe(
    currentTargets.linkSetManifestHash,
  );

  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId,
        contentKeyEpoch: 1,
        linkSetManifestHash: currentTargets.linkSetManifestHash,
        targetHash: currentTargets.documentKeyTargetHash,
        targets: targetEnvelopes(currentTargets, "different-material"),
      },
      db,
    ),
  ).rejects.toMatchObject(
    // Coded stateStale so a losing concurrent writer (e.g. a racing
    // stale-bundle heal) refetches the winner's state and retries instead of
    // treating the conflict as terminal.
    new DocumentContentKeyBundleError(
      "Document content-key bundle conflict",
      409,
      DOCUMENT_SYNC_ERROR_CODES.stateStale,
    ),
  );
});

test("storeDocumentContentKeyBundle rejects missing extra duplicate and stale targets", async () => {
  const { documentId } = await setupDocumentTargets(2);
  const currentTargets = await resolveCurrentDocumentKekTargets(documentId, db);
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
      storeDocumentContentKeyBundle(
        {
          documentId,
          contentKeyEpoch: 1,
          linkSetManifestHash: currentTargets.linkSetManifestHash,
          targetHash: currentTargets.documentKeyTargetHash,
          targets,
        },
        db,
      ),
    ).rejects.toBeInstanceOf(DocumentContentKeyBundleError);
  }

  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId,
        contentKeyEpoch: 1,
        linkSetManifestHash: currentTargets.linkSetManifestHash,
        targetHash: staleTargetHash,
        targets: missingTarget,
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document KEK targets are stale",
      409,
      DOCUMENT_SYNC_ERROR_CODES.stateStale,
    ),
  );
});

test("storeDocumentContentKeyBundle allows additive target growth on the same content key epoch", async () => {
  const setup = await setupDocumentTargets(1);
  const initialTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  const initialEnvelopes = targetEnvelopes(initialTargets);
  await storeDocumentContentKeyBundle(
    {
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: initialTargets.linkSetManifestHash,
      targetHash: initialTargets.documentKeyTargetHash,
      targets: initialEnvelopes,
    },
    db,
  );
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
  await storeVerifiedAccessManifest({ verifiedManifest: expandedManifest }, db);
  const expandedTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
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

  const stored = await storeDocumentContentKeyBundle(
    {
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: expandedTargets.linkSetManifestHash,
      targetHash: expandedTargets.documentKeyTargetHash,
      targets: expandedEnvelopes,
    },
    db,
  );

  expect(stored.contentKeyEpoch).toBe(1);
  expect(stored.targets).toEqual(expandedEnvelopes);
});

test("storeDocumentContentKeyBundle refreshes same-epoch container manifest targets", async () => {
  const setup = await setupDocumentTargets(1);
  const initialTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  const initialEnvelopes = targetEnvelopes(initialTargets);
  await storeDocumentContentKeyBundle(
    {
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: initialTargets.linkSetManifestHash,
      targetHash: initialTargets.documentKeyTargetHash,
      targets: initialEnvelopes,
    },
    db,
  );
  const advancedContainer = await createVerifiedContainerManifest({
    containerId: setup.firstContainerId,
    containerKeyEpochId: `${setup.firstContainerId}:key-epoch-1`,
    epoch: 2,
    organizationId: setup.organizationId,
    previousManifestHash: setup.firstContainer.manifestHash,
    salt: "first-additive-share",
  });
  await storeVerifiedAccessManifest(
    { verifiedManifest: advancedContainer },
    db,
  );
  const refreshedTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  const refreshedEnvelopes = refreshedTargets.targets.map((target) => {
    const existing = initialEnvelopes.find(
      (envelope) => envelope.containerId === target.containerId,
    );
    if (!existing) {
      throw new Error("Expected existing target envelope");
    }
    return {
      ...target,
      wrappedKey: existing.wrappedKey,
      wrappingMetadata: existing.wrappingMetadata,
    };
  });

  expect(refreshedTargets.targets[0]?.containerManifestHash).toBe(
    advancedContainer.manifestHash,
  );
  await expect(
    getLatestCurrentDocumentContentKeyBundle(
      {
        currentTargets: refreshedTargets,
        documentId: setup.documentId,
      },
      db,
    ),
  ).resolves.toMatchObject({
    linkSetManifestHash: refreshedTargets.linkSetManifestHash,
    targetHash: refreshedTargets.documentKeyTargetHash,
    targets: refreshedEnvelopes,
  });

  const refreshedBundle =
    await requireAndRefreshCurrentDocumentContentKeyBundle({
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      expectedLinkSetManifestHash: refreshedTargets.linkSetManifestHash,
      expectedTargetHash: refreshedTargets.documentKeyTargetHash,
      executor: db,
    });

  expect(refreshedBundle.contentKeyEpoch).toBe(1);
  expect(refreshedBundle.targets).toEqual(refreshedEnvelopes);

  const stored = await storeDocumentContentKeyBundle(
    {
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: refreshedTargets.linkSetManifestHash,
      targetHash: refreshedTargets.documentKeyTargetHash,
      targets: refreshedEnvelopes,
    },
    db,
  );

  expect(stored.contentKeyEpoch).toBe(1);
  expect(stored.targets).toEqual(refreshedEnvelopes);
});

test("storeDocumentContentKeyBundle requires a new content key epoch after container move", async () => {
  const setup = await setupDocumentTargets(1);
  const initialTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  const initialEnvelopes = targetEnvelopes(initialTargets);
  await storeDocumentContentKeyBundle(
    {
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: initialTargets.linkSetManifestHash,
      targetHash: initialTargets.documentKeyTargetHash,
      targets: initialEnvelopes,
    },
    db,
  );

  const movedKeyEpochId = `${setup.firstContainerId}:key-epoch-2`;
  const movedContainer = await createVerifiedContainerManifest({
    containerId: setup.firstContainerId,
    containerKeyEpochId: movedKeyEpochId,
    eventType: "container.move",
    epoch: 2,
    organizationId: setup.organizationId,
    parentContainerId: setup.secondContainerId,
    parentManifestHash: setup.secondContainer.manifestHash,
    previousManifestHash: setup.firstContainer.manifestHash,
    salt: "first-move",
  });
  await storeVerifiedAccessManifest({ verifiedManifest: movedContainer }, db);
  await insertContainerKeyEpoch({
    containerId: setup.firstContainerId,
    keyEpoch: 2,
    keyEpochId: movedKeyEpochId,
    manifestHash: movedContainer.manifestHash,
    parentContainerKeyEpochId: `${setup.secondContainerId}:key-epoch-1`,
  });

  const movedTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  await expect(
    getLatestCurrentDocumentContentKeyBundle(
      {
        currentTargets: movedTargets,
        documentId: setup.documentId,
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document content-key bundle is stale",
      409,
      DOCUMENT_SYNC_ERROR_CODES.stateStale,
    ),
  );

  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId: setup.documentId,
        contentKeyEpoch: 1,
        linkSetManifestHash: movedTargets.linkSetManifestHash,
        targetHash: movedTargets.documentKeyTargetHash,
        targets: targetEnvelopes(movedTargets, "moved"),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document content key epoch must rotate after target key material changes",
      409,
    ),
  );

  const rotatedEnvelopes = targetEnvelopes(movedTargets, "rotated");
  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId: setup.documentId,
        contentKeyEpoch: 2,
        linkSetManifestHash: movedTargets.linkSetManifestHash,
        targetHash: movedTargets.documentKeyTargetHash,
        targets: rotatedEnvelopes,
      },
      db,
    ),
  ).resolves.toMatchObject({
    contentKeyEpoch: 2,
    targets: rotatedEnvelopes,
  });
});

test("storeDocumentContentKeyBundle requires a new content key epoch after container rekey", async () => {
  const setup = await setupDocumentTargets(1);
  const initialTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  await storeDocumentContentKeyBundle(
    {
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: initialTargets.linkSetManifestHash,
      targetHash: initialTargets.documentKeyTargetHash,
      targets: targetEnvelopes(initialTargets),
    },
    db,
  );

  const rekeyedKeyEpochId = `${setup.firstContainerId}:key-epoch-2`;
  const rekeyedContainer = await createVerifiedContainerManifest({
    containerId: setup.firstContainerId,
    containerKeyEpochId: rekeyedKeyEpochId,
    eventType: "container.rekey",
    epoch: 2,
    organizationId: setup.organizationId,
    previousManifestHash: setup.firstContainer.manifestHash,
    salt: "first-rekey",
  });
  await storeVerifiedAccessManifest({ verifiedManifest: rekeyedContainer }, db);
  await insertContainerKeyEpoch({
    containerId: setup.firstContainerId,
    keyEpoch: 2,
    keyEpochId: rekeyedKeyEpochId,
    manifestHash: rekeyedContainer.manifestHash,
  });
  const rekeyedTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );

  await expect(
    getLatestCurrentDocumentContentKeyBundle(
      {
        currentTargets: rekeyedTargets,
        documentId: setup.documentId,
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document content-key bundle is stale",
      409,
      DOCUMENT_SYNC_ERROR_CODES.stateStale,
    ),
  );

  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId: setup.documentId,
        contentKeyEpoch: 1,
        linkSetManifestHash: rekeyedTargets.linkSetManifestHash,
        targetHash: rekeyedTargets.documentKeyTargetHash,
        targets: targetEnvelopes(rekeyedTargets, "rekeyed"),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document content key epoch must rotate after target key material changes",
      409,
    ),
  );

  const rotatedEnvelopes = targetEnvelopes(rekeyedTargets, "rotated");
  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId: setup.documentId,
        contentKeyEpoch: 2,
        linkSetManifestHash: rekeyedTargets.linkSetManifestHash,
        targetHash: rekeyedTargets.documentKeyTargetHash,
        targets: rotatedEnvelopes,
      },
      db,
    ),
  ).resolves.toMatchObject({
    contentKeyEpoch: 2,
    targets: rotatedEnvelopes,
  });
});

test("storeDocumentContentKeyBundle requires a new content key epoch after target shrink", async () => {
  const setup = await setupDocumentTargets(2);
  const initialTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  await storeDocumentContentKeyBundle(
    {
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: initialTargets.linkSetManifestHash,
      targetHash: initialTargets.documentKeyTargetHash,
      targets: targetEnvelopes(initialTargets),
    },
    db,
  );
  const shrunkManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [setup.firstContainer.manifestHash],
    documentId: setup.documentId,
    epoch: 2,
    linkedContainerIds: [setup.firstContainerId],
    organizationId: setup.organizationId,
    previousManifestHash: setup.documentManifest.manifestHash,
  });
  await storeVerifiedAccessManifest({ verifiedManifest: shrunkManifest }, db);
  const shrunkTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  const shrunkEnvelopes = targetEnvelopes(shrunkTargets, "rotated");

  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId: setup.documentId,
        contentKeyEpoch: 1,
        linkSetManifestHash: shrunkTargets.linkSetManifestHash,
        targetHash: shrunkTargets.documentKeyTargetHash,
        targets: shrunkEnvelopes,
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document content key epoch must rotate after target key material changes",
      409,
    ),
  );

  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId: setup.documentId,
        contentKeyEpoch: 2,
        linkSetManifestHash: shrunkTargets.linkSetManifestHash,
        targetHash: shrunkTargets.documentKeyTargetHash,
        targets: shrunkEnvelopes,
      },
      db,
    ),
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
    version: 1,
    organizationId,
    objectKind: "document",
    objectId: documentId,
    contentKeyEpoch: 1,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
  });
  const header: WriteHeader = {
    version: 1,
    organizationId,
    objectKind: "document",
    objectId: documentId,
    accessManifestHash: await hashOf("write-header-manifest"),
    contentKeyEpoch: 1,
    targetHash: await hashOf("write-header-targets"),
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
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

  await storeDocumentContentWriteHeader(
    {
      documentId,
      header,
      headerHash,
      updateId,
    },
    db,
  );
  await storeDocumentContentWriteHeader(
    {
      documentId,
      header,
      headerHash,
      updateId,
    },
    db,
  );

  await expect(
    storeDocumentContentWriteHeader(
      {
        documentId,
        header,
        headerHash: await hashOf("write-header-conflict"),
        updateId,
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError("Document write header conflict", 409),
  );
  await expect(
    storeDocumentContentWriteHeader(
      {
        documentId,
        header,
        headerHash,
        updateId: crypto.randomUUID(),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError("Document write header conflict", 409),
  );
  await expect(
    storeDocumentContentWriteHeader(
      {
        documentId,
        header: { ...header, objectKind: "blob" },
        headerHash: await hashOf("write-header-wrong-object"),
        updateId: crypto.randomUUID(),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document write header does not match document",
      409,
    ),
  );

  const secondUpdateId = crypto.randomUUID();
  const secondContentRecordId = "66666666-6666-4666-8666-666666666666";
  const secondHeader: WriteHeader = {
    ...header,
    contentRecordId: secondContentRecordId,
    nonceDomainHash: await computeContentRecordNonceDomainHash({
      version: 1,
      organizationId,
      objectKind: "document",
      objectId: documentId,
      contentKeyEpoch: 1,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId: secondContentRecordId,
    }),
    metadataHash: await hashOf("write-header-second-metadata"),
    ciphertextHash: await hashOf("write-header-second-ciphertext"),
    signature: "signature-2",
  };
  const secondHeaderHash = await hashOf("write-header-second");
  await storeDocumentContentWriteHeader(
    {
      documentId,
      header: secondHeader,
      headerHash: secondHeaderHash,
      updateId: secondUpdateId,
    },
    db,
  );

  expect(
    await listDocumentContentWriteHeaders([updateId, secondUpdateId], db),
  ).toEqual(
    new Map([
      [updateId, { header, headerHash }],
      [secondUpdateId, { header: secondHeader, headerHash: secondHeaderHash }],
    ]),
  );
});

test("storeDocumentContentWriteHeader rejects reused content record domains", async () => {
  const documentId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const contentRecordId = "44444444-4444-4444-8444-444444444444";
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId,
    objectKind: "document",
    objectId: documentId,
    contentKeyEpoch: 1,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
  });
  const header: WriteHeader = {
    version: 1,
    organizationId,
    objectKind: "document",
    objectId: documentId,
    accessManifestHash: await hashOf("record-domain-manifest"),
    contentKeyEpoch: 1,
    targetHash: await hashOf("record-domain-targets"),
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
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

  await storeDocumentContentWriteHeader(
    {
      documentId,
      header,
      headerHash: await hashOf("record-domain-header"),
      updateId: crypto.randomUUID(),
    },
    db,
  );

  await expect(
    storeDocumentContentWriteHeader(
      {
        documentId,
        header: {
          ...header,
          metadataHash: await hashOf("duplicate-record-metadata"),
          ciphertextHash: await hashOf("duplicate-record-ciphertext"),
          signature: "signature-2",
        },
        headerHash: await hashOf("duplicate-record-header"),
        updateId: crypto.randomUUID(),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError("Document write header conflict", 409),
  );

  await expect(
    storeDocumentContentWriteHeader(
      {
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
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError("Document write header conflict", 409),
  );
});

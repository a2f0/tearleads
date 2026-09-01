import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifests,
  attachmentBindings,
  containerKeyEpochs,
} from "@tearleads/api-shared/schema";
import {
  computeBlobContentKeyTargetHash,
  computeKeyingDomainHash,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import {
  type BlobContentKeyTargetEnvelope,
  getLatestCurrentBlobContentKeyBundle,
} from "../read/blobContentKeyStore";
import { resolveCurrentBlobKekTargets } from "../read/blobKekTargets";
import {
  BlobContentKeyBundleError,
  storeBlobContentKeyBundle,
} from "./blobContentKeyStore";

async function hashOf(label: string): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.access-event-body", {
    label,
  });
}

async function ensureContainerHead(input: {
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

async function setDocumentHead(input: {
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

async function attachBlob(input: {
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

function targetEnvelopes(
  targets: Awaited<ReturnType<typeof resolveCurrentBlobKekTargets>>,
  suffix = "initial",
): BlobContentKeyTargetEnvelope[] {
  return targets.targets.map((target) => ({
    ...target,
    wrappedKey: `${target.bindingId}:${target.containerId}:${suffix}`,
    wrappingMetadata: { suite: "test-wrap" },
  }));
}

test("storeBlobContentKeyBundle stores exact active binding targets", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  const manifestHash = await setDocumentHead({
    documentId,
    epoch: 1,
    linkedContainerIds: [crypto.randomUUID(), crypto.randomUUID()],
    organizationId,
  });
  await attachBlob({
    bindingId,
    blobId,
    documentId,
    documentManifestHash: manifestHash,
    slotId: "slot-a",
  });
  const currentTargets = await resolveCurrentBlobKekTargets(blobId, db);
  const envelopes = targetEnvelopes(currentTargets);

  const stored = await storeBlobContentKeyBundle(
    {
      blobId,
      contentKeyEpoch: 1,
      targetHash: currentTargets.blobKeyTargetHash,
      targets: envelopes,
    },
    db,
  );
  expect(stored.targets).toEqual(envelopes);
  expect(stored.currentTargets.blobKeyTargetHash).toBe(
    currentTargets.blobKeyTargetHash,
  );
  expect(stored.currentTargets.blobAccessManifestHash).toBe(
    currentTargets.blobAccessManifestHash,
  );

  const omittedTargets = envelopes.slice(0, 1);
  await expect(
    storeBlobContentKeyBundle(
      {
        blobId,
        contentKeyEpoch: 1,
        targetHash: currentTargets.blobKeyTargetHash,
        targets: omittedTargets,
      },
      db,
    ),
  ).rejects.toBeInstanceOf(BlobContentKeyBundleError);

  await expect(
    storeBlobContentKeyBundle(
      {
        blobId,
        contentKeyEpoch: 1,
        targetHash: await computeBlobContentKeyTargetHash(
          omittedTargets.map((target) => ({
            bindingId: target.bindingId,
            documentId: target.documentId,
            containerId: target.containerId,
            containerManifestHash: target.containerManifestHash,
            containerKeyEpochId: target.containerKeyEpochId,
            containerKeyEpoch: target.containerKeyEpoch,
          })),
        ),
        targets: omittedTargets,
      },
      db,
    ),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError("Blob KEK targets are stale", 409),
  );
});

test("resolveCurrentBlobKekTargets uses the container manifest key epoch", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const manifestHash = await setDocumentHead({
    documentId,
    epoch: 1,
    linkedContainerIds: [containerId],
    organizationId,
  });
  await db.insert(containerKeyEpochs).values({
    id: `${containerId}:unreferenced-key-epoch-2`,
    containerId,
    keyEpoch: 2,
    accessManifestHash: await hashOf(`${containerId}:manifest`),
    parentContainerKeyEpochId: null,
    createdByEventHash: await hashOf(`${containerId}:rogue-event`),
    createdByManifestHash: await hashOf(`${containerId}:manifest`),
  });
  await attachBlob({
    bindingId,
    blobId,
    documentId,
    documentManifestHash: manifestHash,
    slotId: "slot-a",
  });

  const currentTargets = await resolveCurrentBlobKekTargets(blobId, db);

  expect(currentTargets.targets).toEqual([
    {
      bindingId,
      documentId,
      containerId,
      containerManifestHash: await hashOf(`${containerId}:manifest`),
      containerKeyEpochId: `${containerId}:key-epoch-1`,
      containerKeyEpoch: 1,
    },
  ]);
});

test("storeBlobContentKeyBundle rewrites key packages without replacing blob bytes", async () => {
  const organizationId = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  const firstDocumentId = crypto.randomUUID();
  const secondDocumentId = crypto.randomUUID();
  const firstBindingId = crypto.randomUUID();
  const secondBindingId = crypto.randomUUID();
  const firstContainerId = crypto.randomUUID();
  const secondContainerId = crypto.randomUUID();
  const firstManifestHash = await setDocumentHead({
    documentId: firstDocumentId,
    epoch: 1,
    linkedContainerIds: [firstContainerId],
    organizationId,
  });
  const secondManifestHash = await setDocumentHead({
    documentId: secondDocumentId,
    epoch: 1,
    linkedContainerIds: [secondContainerId],
    organizationId,
  });
  await attachBlob({
    bindingId: firstBindingId,
    blobId,
    documentId: firstDocumentId,
    documentManifestHash: firstManifestHash,
    slotId: "slot-a",
  });
  const initialTargets = await resolveCurrentBlobKekTargets(blobId, db);
  const initialEnvelopes = targetEnvelopes(initialTargets);
  await storeBlobContentKeyBundle(
    {
      blobId,
      contentKeyEpoch: 1,
      targetHash: initialTargets.blobKeyTargetHash,
      targets: initialEnvelopes,
    },
    db,
  );

  await attachBlob({
    bindingId: secondBindingId,
    blobId,
    documentId: secondDocumentId,
    documentManifestHash: secondManifestHash,
    slotId: "slot-b",
  });
  const expandedTargets = await resolveCurrentBlobKekTargets(blobId, db);
  const expandedEnvelopes = expandedTargets.targets.map((target) => {
    const existing = initialEnvelopes.find(
      (envelope) =>
        envelope.bindingId === target.bindingId &&
        envelope.documentId === target.documentId &&
        envelope.containerId === target.containerId,
    );
    return (
      existing ?? {
        ...target,
        wrappedKey: `${target.bindingId}:${target.containerId}:expanded`,
        wrappingMetadata: { suite: "test-wrap" },
      }
    );
  });

  const expanded = await storeBlobContentKeyBundle(
    {
      blobId,
      contentKeyEpoch: 1,
      targetHash: expandedTargets.blobKeyTargetHash,
      targets: expandedEnvelopes,
    },
    db,
  );
  expect(expanded.contentKeyEpoch).toBe(1);
  expect(expanded.targets).toEqual(expandedEnvelopes);

  await db
    .update(attachmentBindings)
    .set({ detachedAt: new Date() })
    .where(eq(attachmentBindings.id, secondBindingId));
  const shrunkTargets = await resolveCurrentBlobKekTargets(blobId, db);
  const shrunk = await storeBlobContentKeyBundle(
    {
      blobId,
      contentKeyEpoch: 1,
      targetHash: shrunkTargets.blobKeyTargetHash,
      targets: initialEnvelopes,
    },
    db,
  );
  expect(shrunk.contentKeyEpoch).toBe(1);
  expect(shrunk.targets).toEqual(initialEnvelopes);

  await ensureContainerHead({
    containerId: firstContainerId,
    epoch: 2,
    keyEpoch: 2,
    organizationId,
  });
  const rekeyedTargets = await resolveCurrentBlobKekTargets(blobId, db);
  const rekeyedEnvelopes = targetEnvelopes(rekeyedTargets, "rekeyed");
  const staleBundle = await getLatestCurrentBlobContentKeyBundle(
    {
      blobId,
      currentTargets: rekeyedTargets,
    },
    db,
  );
  expect(staleBundle?.targetHash).toBe(shrunkTargets.blobKeyTargetHash);
  expect(staleBundle?.targets).toEqual(initialEnvelopes);

  const rekeyed = await storeBlobContentKeyBundle(
    {
      blobId,
      contentKeyEpoch: 1,
      targetHash: rekeyedTargets.blobKeyTargetHash,
      targets: rekeyedEnvelopes,
    },
    db,
  );
  expect(rekeyed.contentKeyEpoch).toBe(1);
  expect(rekeyed.targets).toEqual(rekeyedEnvelopes);

  await expect(
    storeBlobContentKeyBundle(
      {
        blobId,
        contentKeyEpoch: 2,
        targetHash: rekeyedTargets.blobKeyTargetHash,
        targets: targetEnvelopes(rekeyedTargets, "replacement-epoch"),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError(
      "Blob content key epoch cannot change without replacing blob bytes",
      409,
    ),
  );
});

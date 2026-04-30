import { expect, test } from "bun:test";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE_V2,
  computeBlobContentKeyTargetHash,
  computeContentRecordNonceDomainHash,
  computeKeyingV2DomainHash,
  type WriteHeaderV2,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { db } from "../adapters/postgres";
import {
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifests,
  attachmentBindings,
  containerKeyEpochs,
} from "../schema";
import {
  BlobContentKeyBundleError,
  type BlobContentKeyTargetEnvelope,
  listBlobContentWriteHeaders,
  storeBlobContentKeyBundle,
  storeBlobContentWriteHeader,
} from "./blobContentKeyStore";
import { resolveCurrentBlobKekTargets } from "./blobKekTargets";

async function hashOf(label: string): Promise<string> {
  return computeKeyingV2DomainHash("tearleads.keying-v2.access-event-body.v1", {
    label,
  });
}

async function ensureContainerHead(input: {
  readonly containerId: string;
  readonly organizationId: string;
}) {
  const manifestHash = await hashOf(`${input.containerId}:manifest`);
  const eventHash = await hashOf(`${input.containerId}:event`);
  const containerKeyEpochId = `${input.containerId}:key-epoch-1`;
  await db
    .insert(accessEvents)
    .values({
      version: 2,
      eventId: `${input.containerId}:event-id`,
      eventType: "container.create",
      objectKind: "container",
      objectId: input.containerId,
      organizationId: input.organizationId,
      previousManifestHash: null,
      dependencyManifestHashes: [],
      bodyHash: await hashOf(`${input.containerId}:body`),
      body: {},
      eventHash,
      signerUserId: `${input.containerId}:user`,
      signerDeviceId: "device-1",
      signerKeyFingerprint: await hashOf(`${input.containerId}:signer`),
      signature: `${input.containerId}:signature`,
      signedAt: new Date(0),
    })
    .onConflictDoNothing({ target: accessEvents.eventHash });
  await db
    .insert(accessManifests)
    .values({
      version: 2,
      objectKind: "container",
      objectId: input.containerId,
      organizationId: input.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash,
      structuralHash: await hashOf(`${input.containerId}:structural`),
      grantRoot: await hashOf(`${input.containerId}:grant-root`),
      referencedPrincipalHeads: [],
      keyTargetHash: await hashOf(`${input.containerId}:key-target`),
      manifestHash,
      state: {
        version: 2,
        containerId: input.containerId,
        organizationId: input.organizationId,
        epoch: 1,
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
      epoch: 1,
      manifestHash,
    })
    .onConflictDoNothing({
      target: [accessManifestHeads.objectKind, accessManifestHeads.objectId],
    });
  await db
    .insert(containerKeyEpochs)
    .values({
      id: containerKeyEpochId,
      containerId: input.containerId,
      keyEpoch: 1,
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

async function createBlobWriteHeader(input: {
  readonly blobId: string;
  readonly contentRecordId: string;
  readonly metadataSalt: string;
  readonly organizationId: string;
  readonly nonceDomainHash?: string;
}): Promise<WriteHeaderV2> {
  const nonceDomainHash =
    input.nonceDomainHash ??
    (await computeContentRecordNonceDomainHash({
      version: 2,
      organizationId: input.organizationId,
      objectKind: "blob",
      objectId: input.blobId,
      contentKeyEpoch: 1,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
      contentRecordId: input.contentRecordId,
    }));

  return {
    version: 2,
    organizationId: input.organizationId,
    objectKind: "blob",
    objectId: input.blobId,
    accessManifestHash: await hashOf(`${input.metadataSalt}:manifest`),
    contentKeyEpoch: 1,
    targetHash: await hashOf(`${input.metadataSalt}:targets`),
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
    contentRecordId: input.contentRecordId,
    nonceDomainHash,
    metadataHash: await hashOf(`${input.metadataSalt}:metadata`),
    ciphertextHash: await hashOf(`${input.metadataSalt}:ciphertext`),
    writerUserId: crypto.randomUUID(),
    writerDeviceId: "device-1",
    writerKeyFingerprint: await hashOf(`${input.metadataSalt}:writer`),
    signedAt: new Date().toISOString(),
    signature: `${input.metadataSalt}:signature`,
  };
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
  const currentTargets = await resolveCurrentBlobKekTargets(blobId);
  const envelopes = targetEnvelopes(currentTargets);

  const stored = await storeBlobContentKeyBundle({
    blobId,
    contentKeyEpoch: 1,
    targetHash: currentTargets.blobKeyTargetHash,
    targets: envelopes,
  });
  expect(stored.targets).toEqual(envelopes);
  expect(stored.currentTargets.blobKeyTargetHash).toBe(
    currentTargets.blobKeyTargetHash,
  );
  expect(stored.currentTargets.blobAccessManifestHash).toBe(
    currentTargets.blobAccessManifestHash,
  );

  const omittedTargets = envelopes.slice(0, 1);
  await expect(
    storeBlobContentKeyBundle({
      blobId,
      contentKeyEpoch: 1,
      targetHash: currentTargets.blobKeyTargetHash,
      targets: omittedTargets,
    }),
  ).rejects.toBeInstanceOf(BlobContentKeyBundleError);

  await expect(
    storeBlobContentKeyBundle({
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
    }),
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

  const currentTargets = await resolveCurrentBlobKekTargets(blobId);

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

test("storeBlobContentKeyBundle allows additive growth but rejects shrink", async () => {
  const organizationId = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  const firstDocumentId = crypto.randomUUID();
  const secondDocumentId = crypto.randomUUID();
  const firstBindingId = crypto.randomUUID();
  const secondBindingId = crypto.randomUUID();
  const firstManifestHash = await setDocumentHead({
    documentId: firstDocumentId,
    epoch: 1,
    linkedContainerIds: [crypto.randomUUID()],
    organizationId,
  });
  const secondManifestHash = await setDocumentHead({
    documentId: secondDocumentId,
    epoch: 1,
    linkedContainerIds: [crypto.randomUUID()],
    organizationId,
  });
  await attachBlob({
    bindingId: firstBindingId,
    blobId,
    documentId: firstDocumentId,
    documentManifestHash: firstManifestHash,
    slotId: "slot-a",
  });
  const initialTargets = await resolveCurrentBlobKekTargets(blobId);
  const initialEnvelopes = targetEnvelopes(initialTargets);
  await storeBlobContentKeyBundle({
    blobId,
    contentKeyEpoch: 1,
    targetHash: initialTargets.blobKeyTargetHash,
    targets: initialEnvelopes,
  });

  await attachBlob({
    bindingId: secondBindingId,
    blobId,
    documentId: secondDocumentId,
    documentManifestHash: secondManifestHash,
    slotId: "slot-b",
  });
  const expandedTargets = await resolveCurrentBlobKekTargets(blobId);
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

  const expanded = await storeBlobContentKeyBundle({
    blobId,
    contentKeyEpoch: 1,
    targetHash: expandedTargets.blobKeyTargetHash,
    targets: expandedEnvelopes,
  });
  expect(expanded.contentKeyEpoch).toBe(1);
  expect(expanded.targets).toEqual(expandedEnvelopes);

  await db
    .update(attachmentBindings)
    .set({ detachedAt: new Date() })
    .where(eq(attachmentBindings.id, secondBindingId));
  const shrunkTargets = await resolveCurrentBlobKekTargets(blobId);
  await expect(
    storeBlobContentKeyBundle({
      blobId,
      contentKeyEpoch: 1,
      targetHash: shrunkTargets.blobKeyTargetHash,
      targets: targetEnvelopes(shrunkTargets, "shrunk"),
    }),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError(
      "Blob content-key targets shrank; replace the blob",
      409,
    ),
  );
});

test("storeBlobContentWriteHeader stores canonical headers by record id", async () => {
  const recordId = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const header = await createBlobWriteHeader({
    blobId,
    contentRecordId: "66666666-6666-4666-8666-666666666666",
    metadataSalt: "blob-write-header",
    organizationId,
  });
  const headerHash = await hashOf("blob-write-header");

  await storeBlobContentWriteHeader({
    blobId,
    header,
    headerHash,
    recordId,
  });
  await storeBlobContentWriteHeader({
    blobId,
    header,
    headerHash,
    recordId,
  });

  await expect(
    storeBlobContentWriteHeader({
      blobId,
      header,
      headerHash: await hashOf("blob-write-header-conflict"),
      recordId,
    }),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError("Blob write header conflict", 409),
  );
  await expect(
    storeBlobContentWriteHeader({
      blobId,
      header,
      headerHash,
      recordId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError("Blob write header conflict", 409),
  );
  await expect(
    storeBlobContentWriteHeader({
      blobId,
      header: { ...header, objectKind: "document" },
      headerHash: await hashOf("blob-write-header-wrong-object"),
      recordId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError("Blob write header does not match blob", 409),
  );
  await expect(
    storeBlobContentWriteHeader({
      blobId,
      header: { ...header, contentKeyEpoch: 2 },
      headerHash: await hashOf("blob-write-header-unsupported-epoch"),
      recordId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError(
      "Blob content key epoch must be 1; replace the blob after target shrink",
      409,
    ),
  );

  const secondRecordId = crypto.randomUUID();
  const secondHeader = await createBlobWriteHeader({
    blobId,
    contentRecordId: "99999999-9999-4999-8999-999999999999",
    metadataSalt: "blob-write-header-second",
    organizationId,
  });
  const secondHeaderHash = await hashOf("blob-write-header-second");
  await storeBlobContentWriteHeader({
    blobId,
    header: secondHeader,
    headerHash: secondHeaderHash,
    recordId: secondRecordId,
  });

  expect(await listBlobContentWriteHeaders([recordId, secondRecordId])).toEqual(
    new Map([
      [recordId, { header, headerHash }],
      [secondRecordId, { header: secondHeader, headerHash: secondHeaderHash }],
    ]),
  );
});

test("storeBlobContentWriteHeader rejects reused content record domains", async () => {
  const blobId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const contentRecordId = "77777777-7777-4777-8777-777777777777";
  const header = await createBlobWriteHeader({
    blobId,
    contentRecordId,
    metadataSalt: "blob-record-domain",
    organizationId,
  });

  await storeBlobContentWriteHeader({
    blobId,
    header,
    headerHash: await hashOf("blob-record-domain-header"),
    recordId: crypto.randomUUID(),
  });

  await expect(
    storeBlobContentWriteHeader({
      blobId,
      header: {
        ...header,
        metadataHash: await hashOf("blob-duplicate-record-metadata"),
        ciphertextHash: await hashOf("blob-duplicate-record-ciphertext"),
        signature: "blob-signature-2",
      },
      headerHash: await hashOf("blob-duplicate-record-header"),
      recordId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError("Blob write header conflict", 409),
  );

  await expect(
    storeBlobContentWriteHeader({
      blobId,
      header: {
        ...header,
        contentRecordId: "88888888-8888-4888-8888-888888888888",
        metadataHash: await hashOf("blob-duplicate-domain-metadata"),
        ciphertextHash: await hashOf("blob-duplicate-domain-ciphertext"),
        signature: "blob-signature-3",
      },
      headerHash: await hashOf("blob-duplicate-domain-header"),
      recordId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject(
    new BlobContentKeyBundleError("Blob write header conflict", 409),
  );
});

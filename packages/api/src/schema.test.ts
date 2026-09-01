import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEventDependencyProjection,
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  accessManifests,
  blobContentKeyEpochs,
  blobContentKeyTargets,
  blobContentWriteHeaders,
  containerKeyEpochs,
  containerKeyWraps,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documentContentWriteHeaders,
  documentUpdateSpans,
} from "@tearleads/api-shared/schema";
import type {
  KeyingCanonicalJson,
  ReferencedPrincipalHead,
  WriteHeader,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";

const contentRecordEncryptionSuite = "aes-256-gcm-hkdf-sha256-record-key";

function fixtureHash(label: string) {
  return `schema-test:${label}:${crypto.randomUUID()}`;
}

function createWriteHeader(input: {
  readonly accessManifestHash: string;
  readonly contentKeyEpoch: number;
  readonly contentRecordId: string;
  readonly nonceDomainHash: string;
  readonly objectId: string;
  readonly objectKind: "blob" | "document";
  readonly organizationId: string;
  readonly targetHash: string;
  readonly writerUserId: string;
}): WriteHeader {
  return {
    version: 1,
    organizationId: input.organizationId,
    objectKind: input.objectKind,
    objectId: input.objectId,
    accessManifestHash: input.accessManifestHash,
    contentKeyEpoch: input.contentKeyEpoch,
    targetHash: input.targetHash,
    encryptionSuite: contentRecordEncryptionSuite,
    contentRecordId: input.contentRecordId,
    nonceDomainHash: input.nonceDomainHash,
    metadataHash: fixtureHash(`${input.objectKind}:metadata`),
    ciphertextHash: fixtureHash(`${input.objectKind}:ciphertext`),
    writerUserId: input.writerUserId,
    writerDeviceId: "schema-test-device",
    writerKeyFingerprint: fixtureHash(`${input.objectKind}:writer-key`),
    signedAt: new Date().toISOString(),
    signature: fixtureHash(`${input.objectKind}:signature`),
  };
}

test("document_update_spans stores visible causal index rows", async () => {
  const documentId = crypto.randomUUID();
  const updateId = crypto.randomUUID();

  await db.insert(documentUpdateSpans).values([
    {
      documentId,
      updateId,
      peerId: "1",
      startCounter: 0,
      endCounter: 3,
    },
    {
      documentId,
      updateId,
      peerId: "2",
      startCounter: 4,
      endCounter: 9,
    },
  ]);

  const spans = await db
    .select({
      endCounter: documentUpdateSpans.endCounter,
      peerId: documentUpdateSpans.peerId,
      startCounter: documentUpdateSpans.startCounter,
    })
    .from(documentUpdateSpans)
    .where(eq(documentUpdateSpans.updateId, updateId))
    .orderBy(documentUpdateSpans.peerId);

  expect(spans).toEqual([
    {
      endCounter: 3,
      peerId: "1",
      startCounter: 0,
    },
    {
      endCounter: 9,
      peerId: "2",
      startCounter: 4,
    },
  ]);
});

test("access manifest schema stores critical rows through Drizzle", async () => {
  const organizationId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  const writerUserId = crypto.randomUUID();
  const eventHash = fixtureHash("event");
  const eventId = crypto.randomUUID();
  const dependencyManifestHash = fixtureHash("dependency-manifest");
  const containerManifestHash = fixtureHash("container-manifest");
  const documentManifestHash = fixtureHash("document-manifest");
  const blobManifestHash = fixtureHash("blob-manifest");
  const containerKeyEpochId = fixtureHash("container-key-epoch");
  const documentTargetHash = fixtureHash("document-target");
  const blobTargetHash = fixtureHash("blob-target");
  const principalHead = {
    principalType: "group",
    principalId: crypto.randomUUID(),
    version: 1,
    keyEpoch: 1,
    stateHash: fixtureHash("principal-state"),
    keyFingerprint: fixtureHash("principal-key"),
  } satisfies ReferencedPrincipalHead;
  const eventBody = {
    eventType: "container.create",
    containerKeyEpochId,
    directGrants: [],
    metadataDocumentId: documentId,
    parentContainerId: null,
    parentManifestHash: null,
    referencedPrincipalHeads: [principalHead],
  } satisfies KeyingCanonicalJson;
  const manifestState = {
    version: 1,
    containerId,
    organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    directGrants: [],
    referencedPrincipalHeads: [principalHead],
    containerKeyEpochId,
    metadataDocumentId: documentId,
    parentContainerId: null,
    parentManifestHash: null,
  } satisfies KeyingCanonicalJson;
  const wrapMetadata = {
    suite: "schema-test-wrap",
    iv: fixtureHash("wrap-iv"),
  } satisfies KeyingCanonicalJson;
  const documentContentEpochId = crypto.randomUUID();
  const blobContentEpochId = crypto.randomUUID();
  const documentContentRecordId = fixtureHash("document-content-record");
  const blobContentRecordId = fixtureHash("blob-content-record");
  const documentNonceDomainHash = fixtureHash("document-nonce-domain");
  const blobNonceDomainHash = fixtureHash("blob-nonce-domain");
  const eventSignedAt = new Date("2026-05-03T16:00:00.000Z");
  const documentHeader = createWriteHeader({
    accessManifestHash: documentManifestHash,
    contentKeyEpoch: 1,
    contentRecordId: documentContentRecordId,
    nonceDomainHash: documentNonceDomainHash,
    objectId: documentId,
    objectKind: "document",
    organizationId,
    targetHash: documentTargetHash,
    writerUserId,
  });
  const blobHeader = createWriteHeader({
    accessManifestHash: blobManifestHash,
    contentKeyEpoch: 1,
    contentRecordId: blobContentRecordId,
    nonceDomainHash: blobNonceDomainHash,
    objectId: blobId,
    objectKind: "blob",
    organizationId,
    targetHash: blobTargetHash,
    writerUserId,
  });

  await db.insert(accessEvents).values({
    version: 1,
    eventId,
    eventType: "container.create",
    objectKind: "container",
    objectId: containerId,
    organizationId,
    previousManifestHash: null,
    dependencyManifestHashes: [dependencyManifestHash],
    bodyHash: fixtureHash("body"),
    body: eventBody,
    eventHash,
    signerUserId: writerUserId,
    signerDeviceId: "schema-test-device",
    signerKeyFingerprint: fixtureHash("signer-key"),
    signature: fixtureHash("event-signature"),
    signedAt: eventSignedAt,
  });
  await db.insert(accessEventDependencyProjection).values({
    eventHash,
    objectKind: "container",
    objectId: containerId,
    dependencyManifestHash,
    dependencyIndex: 0,
  });
  await db.insert(accessManifests).values({
    version: 1,
    objectKind: "container",
    objectId: containerId,
    organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    structuralHash: fixtureHash("structural"),
    grantRoot: fixtureHash("grant-root"),
    referencedPrincipalHeads: [principalHead],
    keyTargetHash: fixtureHash("key-target"),
    manifestHash: containerManifestHash,
    state: manifestState,
  });
  await db.insert(accessManifestHeads).values({
    objectKind: "container",
    objectId: containerId,
    organizationId,
    epoch: 1,
    manifestHash: containerManifestHash,
  });
  await db.insert(accessManifestPrincipalHeadProjection).values({
    manifestHash: containerManifestHash,
    objectKind: "container",
    objectId: containerId,
    principalType: principalHead.principalType,
    principalId: principalHead.principalId,
    version: principalHead.version,
    keyEpoch: principalHead.keyEpoch,
    stateHash: principalHead.stateHash,
    keyFingerprint: principalHead.keyFingerprint,
  });
  await db.insert(accessManifestDocumentLinkProjection).values({
    manifestHash: documentManifestHash,
    documentId,
    containerId,
  });
  await db.insert(containerKeyEpochs).values({
    id: containerKeyEpochId,
    containerId,
    keyEpoch: 1,
    accessManifestHash: containerManifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: eventHash,
    createdByManifestHash: containerManifestHash,
  });
  await db.insert(containerKeyWraps).values({
    containerKeyEpochId,
    recipientKind: "user",
    recipientId: writerUserId,
    recipientKeyEpochId: fixtureHash("recipient-key-epoch"),
    recipientKeyFingerprint: fixtureHash("recipient-key-fingerprint"),
    kemCipherText: fixtureHash("kem-cipher-text"),
    wrappedKey: fixtureHash("container-wrapped-key"),
    wrapManifestHash: containerManifestHash,
  });
  await db.insert(documentContentKeyEpochs).values({
    id: documentContentEpochId,
    documentId,
    contentKeyEpoch: 1,
    linkSetManifestHash: documentManifestHash,
    targetHash: documentTargetHash,
  });
  await db.insert(documentContentKeyTargets).values({
    documentContentKeyEpochId: documentContentEpochId,
    containerId,
    containerManifestHash,
    containerKeyEpochId,
    containerKeyEpoch: 1,
    wrappedKey: fixtureHash("document-wrapped-key"),
    wrappingMetadata: wrapMetadata,
  });
  await db.insert(documentContentWriteHeaders).values({
    updateId: crypto.randomUUID(),
    documentId,
    organizationId,
    contentKeyEpoch: 1,
    accessManifestHash: documentManifestHash,
    targetHash: documentTargetHash,
    encryptionSuite: contentRecordEncryptionSuite,
    contentRecordId: documentContentRecordId,
    nonceDomainHash: documentNonceDomainHash,
    headerHash: fixtureHash("document-header"),
    header: documentHeader,
  });
  await db.insert(blobContentKeyEpochs).values({
    id: blobContentEpochId,
    blobId,
    contentKeyEpoch: 1,
    targetHash: blobTargetHash,
  });
  await db.insert(blobContentKeyTargets).values({
    blobContentKeyEpochId: blobContentEpochId,
    bindingId,
    documentId,
    containerId,
    containerManifestHash,
    containerKeyEpochId,
    containerKeyEpoch: 1,
    wrappedKey: fixtureHash("blob-wrapped-key"),
    wrappingMetadata: wrapMetadata,
  });
  await db.insert(blobContentWriteHeaders).values({
    recordId: crypto.randomUUID(),
    blobId,
    organizationId,
    contentKeyEpoch: 1,
    accessManifestHash: blobManifestHash,
    targetHash: blobTargetHash,
    encryptionSuite: contentRecordEncryptionSuite,
    contentRecordId: blobContentRecordId,
    nonceDomainHash: blobNonceDomainHash,
    headerHash: fixtureHash("blob-header"),
    header: blobHeader,
  });

  const storedEvents = await db
    .select({
      body: accessEvents.body,
      dependencyManifestHashes: accessEvents.dependencyManifestHashes,
      eventHash: accessEvents.eventHash,
      signedAt: accessEvents.signedAt,
    })
    .from(accessEvents)
    .where(eq(accessEvents.eventHash, eventHash));
  expect(storedEvents).toEqual([
    {
      body: eventBody,
      dependencyManifestHashes: [dependencyManifestHash],
      eventHash,
      signedAt: eventSignedAt,
    },
  ]);

  const storedManifests = await db
    .select({
      manifestHash: accessManifests.manifestHash,
      referencedPrincipalHeads: accessManifests.referencedPrincipalHeads,
      state: accessManifests.state,
    })
    .from(accessManifests)
    .where(eq(accessManifests.manifestHash, containerManifestHash));
  expect(storedManifests).toEqual([
    {
      manifestHash: containerManifestHash,
      referencedPrincipalHeads: [principalHead],
      state: manifestState,
    },
  ]);

  expect(
    await db
      .select({
        dependencyManifestHash:
          accessEventDependencyProjection.dependencyManifestHash,
        eventHash: accessEventDependencyProjection.eventHash,
      })
      .from(accessEventDependencyProjection)
      .where(eq(accessEventDependencyProjection.eventHash, eventHash)),
  ).toEqual([{ dependencyManifestHash, eventHash }]);
  expect(
    await db
      .select({
        manifestHash: accessManifestHeads.manifestHash,
        objectId: accessManifestHeads.objectId,
      })
      .from(accessManifestHeads)
      .where(eq(accessManifestHeads.objectId, containerId)),
  ).toEqual([{ manifestHash: containerManifestHash, objectId: containerId }]);
  expect(
    await db
      .select({
        manifestHash: accessManifestPrincipalHeadProjection.manifestHash,
        principalId: accessManifestPrincipalHeadProjection.principalId,
      })
      .from(accessManifestPrincipalHeadProjection)
      .where(
        eq(
          accessManifestPrincipalHeadProjection.manifestHash,
          containerManifestHash,
        ),
      ),
  ).toEqual([
    {
      manifestHash: containerManifestHash,
      principalId: principalHead.principalId,
    },
  ]);
  expect(
    await db
      .select({
        containerId: accessManifestDocumentLinkProjection.containerId,
        documentId: accessManifestDocumentLinkProjection.documentId,
      })
      .from(accessManifestDocumentLinkProjection)
      .where(
        eq(
          accessManifestDocumentLinkProjection.manifestHash,
          documentManifestHash,
        ),
      ),
  ).toEqual([{ containerId, documentId }]);
  expect(
    await db
      .select({
        accessManifestHash: containerKeyEpochs.accessManifestHash,
        id: containerKeyEpochs.id,
      })
      .from(containerKeyEpochs)
      .where(eq(containerKeyEpochs.id, containerKeyEpochId)),
  ).toEqual([
    { accessManifestHash: containerManifestHash, id: containerKeyEpochId },
  ]);
  expect(
    await db
      .select({
        containerKeyEpochId: containerKeyWraps.containerKeyEpochId,
        recipientId: containerKeyWraps.recipientId,
      })
      .from(containerKeyWraps)
      .where(eq(containerKeyWraps.containerKeyEpochId, containerKeyEpochId)),
  ).toEqual([{ containerKeyEpochId, recipientId: writerUserId }]);
  expect(
    await db
      .select({
        documentId: documentContentKeyEpochs.documentId,
        targetHash: documentContentKeyEpochs.targetHash,
      })
      .from(documentContentKeyEpochs)
      .where(eq(documentContentKeyEpochs.id, documentContentEpochId)),
  ).toEqual([{ documentId, targetHash: documentTargetHash }]);
  expect(
    await db
      .select({
        containerKeyEpochId: documentContentKeyTargets.containerKeyEpochId,
        wrappingMetadata: documentContentKeyTargets.wrappingMetadata,
      })
      .from(documentContentKeyTargets)
      .where(
        eq(
          documentContentKeyTargets.documentContentKeyEpochId,
          documentContentEpochId,
        ),
      ),
  ).toEqual([{ containerKeyEpochId, wrappingMetadata: wrapMetadata }]);
  expect(
    await db
      .select({
        contentRecordId: documentContentWriteHeaders.contentRecordId,
        header: documentContentWriteHeaders.header,
      })
      .from(documentContentWriteHeaders)
      .where(
        eq(
          documentContentWriteHeaders.contentRecordId,
          documentContentRecordId,
        ),
      ),
  ).toEqual([
    { contentRecordId: documentContentRecordId, header: documentHeader },
  ]);
  expect(
    await db
      .select({
        blobId: blobContentKeyEpochs.blobId,
        targetHash: blobContentKeyEpochs.targetHash,
      })
      .from(blobContentKeyEpochs)
      .where(eq(blobContentKeyEpochs.id, blobContentEpochId)),
  ).toEqual([{ blobId, targetHash: blobTargetHash }]);
  expect(
    await db
      .select({
        bindingId: blobContentKeyTargets.bindingId,
        wrappingMetadata: blobContentKeyTargets.wrappingMetadata,
      })
      .from(blobContentKeyTargets)
      .where(
        eq(blobContentKeyTargets.blobContentKeyEpochId, blobContentEpochId),
      ),
  ).toEqual([{ bindingId, wrappingMetadata: wrapMetadata }]);
  expect(
    await db
      .select({
        contentRecordId: blobContentWriteHeaders.contentRecordId,
        header: blobContentWriteHeaders.header,
      })
      .from(blobContentWriteHeaders)
      .where(eq(blobContentWriteHeaders.contentRecordId, blobContentRecordId)),
  ).toEqual([{ contentRecordId: blobContentRecordId, header: blobHeader }]);
});

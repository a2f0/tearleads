import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  accessManifests,
  containerKeyEpochs,
  containerKeyWraps,
  documentUpdateSpans,
} from "@tearleads/api-shared/schema";
import type {
  KeyingCanonicalJson,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { containerWrappingPublicKeyForTest } from "@tearleads/crypto/test-fixtures";
import { eq } from "drizzle-orm";
import {
  createLinkedContainerIds,
  fixtureHash,
} from "../test/helpers/accessSchemaRows";

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

test("access manifest schema stores events, manifests, heads, and projections through Drizzle", async () => {
  const {
    containerId,
    containerKeyEpochId,
    containerManifestHash,
    documentId,
    organizationId,
    writerUserId,
  } = createLinkedContainerIds();
  const eventHash = fixtureHash("event");
  const eventId = crypto.randomUUID();
  const dependencyManifestHash = fixtureHash("dependency-manifest");
  const documentManifestHash = fixtureHash("document-manifest");
  const principalHead = {
    principalType: "group",
    principalId: crypto.randomUUID(),
    version: 1,
    keyEpoch: 1,
    stateHash: fixtureHash("principal-state"),
    keyFingerprint: fixtureHash("principal-key"),
  } satisfies ReferencedPrincipalHead;
  const eventBody = {
    containerKeyPublicKey:
      containerWrappingPublicKeyForTest(containerKeyEpochId),
    systemSlot: null,
    eventType: "container.create",
    containerKeyEpochId,
    directGrants: [],
    metadataDocumentId: documentId,
    parentContainerId: null,
    parentManifestHash: null,
    referencedPrincipalHeads: [principalHead],
  } satisfies KeyingCanonicalJson;
  const manifestState = {
    containerKeyPublicKey:
      containerWrappingPublicKeyForTest(containerKeyEpochId),
    systemSlot: null,
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
  const eventSignedAt = new Date("2026-05-03T16:00:00.000Z");

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
});

test("container key schema stores epochs and wraps through Drizzle", async () => {
  const {
    containerId,
    containerKeyEpochId,
    containerManifestHash,
    writerUserId,
  } = createLinkedContainerIds();
  const eventHash = fixtureHash("event");

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
});

import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifests,
  documents,
} from "@tearleads/api-shared/schema";
import {
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  type DocumentLinkAccessEventBody,
  type DocumentLinkSetManifestState,
  deriveDocumentLinkSetManifest,
  type KeyingCanonicalJson,
  makeVerifiedAccessEvent,
  makeVerifiedDocumentLinkSetManifest,
  signAccessEvent,
  type UnsignedAccessEvent,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { storeVerifiedAccessManifest } from "../../src/access/write/accessManifestStore";
import { accessManifestCheckpoint } from "../../src/keyingProjectionRecords";

export async function createCurrentDocumentProjection(input: {
  readonly containerIds: readonly string[];
  readonly createdByFingerprint: string;
  readonly documentId?: string;
  readonly epoch?: number;
  readonly manifestHash?: string;
  readonly organizationId: string;
  readonly signerPrivateKey?: Uint8Array;
  readonly signerUserId?: string;
}) {
  const [document] = await db
    .insert(documents)
    .values({
      ...(input.documentId ? { id: input.documentId } : {}),
      createdByFingerprint: input.createdByFingerprint,
    })
    .returning({ createdAt: documents.createdAt, id: documents.id });

  if (!document) {
    throw new Error("Failed to create current document projection fixture");
  }

  if (input.signerPrivateKey && input.signerUserId) {
    const containerId = input.containerIds[0];
    if (!containerId || input.containerIds.length !== 1) {
      throw new Error("Signed document fixture requires one container");
    }
    const [containerHead] = await db
      .select({ manifestHash: accessManifestHeads.manifestHash })
      .from(accessManifestHeads)
      .where(eq(accessManifestHeads.objectId, containerId))
      .limit(1);
    if (!containerHead) {
      throw new Error("Signed document fixture container head is missing");
    }
    const body: DocumentLinkAccessEventBody = {
      eventType: "document.link",
      containerId,
      containerManifestHash: containerHead.manifestHash,
    };
    const unsigned: UnsignedAccessEvent = {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: "document.link",
      objectKind: "document",
      objectId: document.id,
      organizationId: input.organizationId,
      previousManifestHash: null,
      dependencyManifestHashes: [containerHead.manifestHash],
      bodyHash: await computeAccessEventBodyHash(
        body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: input.signerUserId,
      signerDeviceId: `signing-key:${input.createdByFingerprint}`,
      signerKeyFingerprint: input.createdByFingerprint,
      signedAt: "2026-05-05T00:00:00.000Z",
    };
    const event = await signAccessEvent(unsigned, input.signerPrivateKey);
    const eventHash = await computeAccessEventHash(event);
    const state: DocumentLinkSetManifestState = {
      version: 1,
      documentId: document.id,
      organizationId: input.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash,
      linkedContainerIds: [containerId],
    };
    const manifest = await deriveDocumentLinkSetManifest(state);
    const manifestHash = await computeAccessManifestHash(manifest);
    const verifiedEvent = makeVerifiedAccessEvent({
      body: body as unknown as KeyingCanonicalJson,
      event,
      eventHash,
    });
    await storeVerifiedAccessManifest(
      {
        verifiedManifest: makeVerifiedDocumentLinkSetManifest({
          checkpoint: accessManifestCheckpoint({ manifest, manifestHash }),
          event: verifiedEvent,
          manifest,
          manifestHash,
          state,
        }),
      },
      db,
    );
    return {
      createdAt: document.createdAt,
      id: document.id,
      linkedContainerIds: [containerId],
      manifestHash,
      epoch: 1,
    };
  }

  const manifestHash =
    input.manifestHash ?? `test-document-manifest:${crypto.randomUUID()}`;
  const epoch = input.epoch ?? 1;
  const eventHash = `test-document-event:${crypto.randomUUID()}`;
  const state = {
    version: 1,
    documentId: document.id,
    organizationId: input.organizationId,
    epoch,
    previousManifestHash: null,
    eventHash,
    linkedContainerIds: [...input.containerIds].sort(),
  };

  await db.insert(accessEvents).values({
    body: {},
    bodyHash: `test-body:${crypto.randomUUID()}`,
    dependencyManifestHashes: [],
    eventHash,
    eventId: crypto.randomUUID(),
    eventType: "document.link",
    objectId: document.id,
    objectKind: "document",
    organizationId: input.organizationId,
    previousManifestHash: null,
    signature: "test-signature",
    signedAt: new Date(),
    signerDeviceId: "test-device",
    signerKeyFingerprint: input.createdByFingerprint,
    signerUserId: input.signerUserId ?? crypto.randomUUID(),
    version: 1,
  });
  await db.insert(accessManifests).values({
    epoch,
    eventHash,
    grantRoot: "test-grant-root",
    keyTargetHash: "test-key-target",
    manifestHash,
    objectId: document.id,
    objectKind: "document",
    organizationId: input.organizationId,
    previousManifestHash: null,
    referencedPrincipalHeads: [],
    state,
    structuralHash: "test-structural",
    version: 1,
  });
  await db.insert(accessManifestHeads).values({
    epoch,
    manifestHash,
    objectId: document.id,
    objectKind: "document",
    organizationId: input.organizationId,
  });
  await db.insert(accessManifestDocumentLinkProjection).values(
    input.containerIds.map((containerId) => ({
      containerId,
      documentId: document.id,
      manifestHash,
    })),
  );

  return {
    createdAt: document.createdAt,
    id: document.id,
    linkedContainerIds: [...input.containerIds].sort(),
    manifestHash,
    epoch,
  };
}

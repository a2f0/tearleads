import { db } from "../../src/adapters/postgres";
import {
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifests,
  documents,
} from "../../src/schema";

export async function createCurrentDocumentProjection(input: {
  readonly containerIds: readonly string[];
  readonly createdByFingerprint: string;
  readonly documentId?: string;
  readonly epoch?: number;
  readonly manifestHash?: string;
  readonly organizationId: string;
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

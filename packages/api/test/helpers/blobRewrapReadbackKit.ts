import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifests,
  attachmentBindings,
  blobContentKeyEpochs,
  blobContentKeyTargets,
  blobs,
  containerDocumentSyncTombstones,
  containers,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { readKeyingCanonicalJson } from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import { eq, inArray } from "drizzle-orm";
import { routeApp } from "../../src/routeApp";
import { authenticate } from "./authenticate";
import { bindForTest, buildBind, stageBlob } from "./blobAttachmentKit";
import { contentKeyEnvelopeFixture } from "./contentKeyEnvelope";
import { createChildContainer } from "./keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
  kekStateFromContainerResponse,
} from "./keyingWriterProjectionKit";
import { registerUser } from "./registerUser";

export async function blobRewrapFixture() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const { request: bind } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: await stageBlob(owner, blobId),
  });
  await bindForTest({ blobId, owner, request: bind });
  const rawTarget = bind.contentKeyBundle.targets[0];
  if (!rawTarget) throw new Error("Expected root target");
  const rootTarget = {
    ...rawTarget,
    wrappingMetadata: readKeyingCanonicalJson(
      rawTarget.wrappingMetadata,
      "wrap",
    ),
  };
  const childKek = await kekStateFromContainerResponse(child);
  const childTarget = {
    ...rootTarget,
    containerId: child.containerId,
    containerManifestHash: childKek.accessManifestHash,
    containerKeyEpochId: childKek.containerKeyEpochId,
    containerKeyEpoch: childKek.containerKeyEpoch,
    wrappedKey: contentKeyEnvelopeFixture("Blob", "authentic-child-wrap")
      .wrappedKey,
  };
  return { owner, root, child, document, blobId, rootTarget, childTarget };
}

export type BlobRewrapFixture = Awaited<ReturnType<typeof blobRewrapFixture>>;

export async function postBlobRewrap(
  fixture: BlobRewrapFixture,
  operation: "link" | "unlink",
  request: unknown,
  app = routeApp,
) {
  const response = await app.request(
    `/documents/${fixture.document.id}/${operation}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  return { status: response.status, body: await response.json() };
}

/** All transaction-owned rows for this document/blob and its touched containers. */
export async function snapshotBlobRewrap(fixture: BlobRewrapFixture) {
  const documentId = fixture.document.id;
  const blobId = fixture.blobId;
  const blobEpochIds = db
    .select({ id: blobContentKeyEpochs.id })
    .from(blobContentKeyEpochs)
    .where(eq(blobContentKeyEpochs.blobId, blobId));
  const documentEpochIds = db
    .select({ id: documentContentKeyEpochs.id })
    .from(documentContentKeyEpochs)
    .where(eq(documentContentKeyEpochs.documentId, documentId));
  const rows = await Promise.all([
    db.select().from(documents).where(eq(documents.id, documentId)),
    db
      .select()
      .from(containers)
      .where(
        inArray(containers.id, [
          fixture.root.kekState.containerId,
          fixture.child.containerId,
        ]),
      ),
    db
      .select()
      .from(accessEvents)
      .where(inArray(accessEvents.objectId, [documentId, blobId])),
    db
      .select()
      .from(accessManifests)
      .where(eq(accessManifests.objectId, documentId)),
    db
      .select()
      .from(accessManifestHeads)
      .where(eq(accessManifestHeads.objectId, documentId)),
    db
      .select()
      .from(accessManifestDocumentLinkProjection)
      .where(eq(accessManifestDocumentLinkProjection.documentId, documentId)),
    db
      .select()
      .from(documentContentKeyEpochs)
      .where(eq(documentContentKeyEpochs.documentId, documentId)),
    db
      .select()
      .from(documentContentKeyTargets)
      .where(
        inArray(
          documentContentKeyTargets.documentContentKeyEpochId,
          documentEpochIds,
        ),
      ),
    db
      .select()
      .from(documentUpdates)
      .where(eq(documentUpdates.documentId, documentId)),
    db
      .select()
      .from(containerDocumentSyncTombstones)
      .where(eq(containerDocumentSyncTombstones.documentId, documentId)),
    db.select().from(blobs).where(eq(blobs.id, blobId)),
    db
      .select()
      .from(attachmentBindings)
      .where(eq(attachmentBindings.blobId, blobId)),
    db
      .select()
      .from(blobContentKeyEpochs)
      .where(eq(blobContentKeyEpochs.blobId, blobId)),
    db
      .select()
      .from(blobContentKeyTargets)
      .where(
        inArray(blobContentKeyTargets.blobContentKeyEpochId, blobEpochIds),
      ),
  ]);
  // Stable row order without normalizing any persisted bytes or timestamps.
  return rows.map((table) => table.map((row) => JSON.stringify(row)).sort());
}

export async function expectBlobRewrapUnchanged(
  fixture: BlobRewrapFixture,
  before: Awaited<ReturnType<typeof snapshotBlobRewrap>>,
) {
  expect(await snapshotBlobRewrap(fixture)).toEqual(before);
}

import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifests,
  attachmentBindings,
  blobAuditObjects,
  blobs,
  containerDocumentSyncTombstones,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documentContentWriteHeaders,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import {
  isDocumentLinkSetMutationResponse,
  isDocumentPurgeProofResponse,
  isDocumentPurgeResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import {
  readBlobObjectText,
  uploadBlobObject,
} from "../../../test/helpers/blobObjectStore";
import { currentDocumentLinkRows } from "../../../test/helpers/currentDocumentLinks";
import type { CreatedDocumentFixture } from "../../../test/helpers/documentAcknowledgementFixture";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import { postDocumentPurge } from "../../../test/helpers/documentPurge";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";
import { createFailingRuntime } from "../../../test/helpers/serviceRuntime";
import type { StoredContainerMutation } from "../../../test/helpers/storedContainerMutation";
import { createRouteApp, routeApp } from "../../routeApp";
import { getDefaultApiServiceRuntime } from "../../services/runtime";

async function linkDocumentToSecondContainer(input: {
  readonly child: StoredContainerMutation;
  readonly createdDocument: CreatedDocumentFixture;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<void> {
  const request = await buildDocumentLinkRequest(input);
  const response = await routeApp.request(
    `/documents/${input.createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  expect(response.status).toBe(200);
  expect(isDocumentLinkSetMutationResponse(await response.json())).toBe(true);
}

// Writes `bytes` into the production runtime's object store at `storageKey`
// using the same multipart API the blob upload flow uses, so a purge that calls
// deleteObject(storageKey) can be observed against the store routeApp uses.
async function putBlobObjectBytes(
  storageKey: string,
  bytes: string,
): Promise<void> {
  const store = getDefaultApiServiceRuntime().blobObjectStore;
  await uploadBlobObject(store, storageKey, bytes);
}

interface SeededAttachment {
  readonly bindingId: string;
  readonly blobId: string;
  readonly storageKey: string;
}

// Inserts a committed object-store-backed blob plus an active attachment
// binding to `documentId`. The blob bytes live in the runtime object store at
// `storageKey`, mirroring a promoted multipart upload.
async function seedExternalBlobAttachment(input: {
  readonly documentId: string;
  readonly documentManifestHash: string;
  readonly slotId: string;
  readonly bytes?: string;
  readonly blobId?: string;
  readonly storageKey?: string;
}): Promise<SeededAttachment> {
  const blobId = input.blobId ?? crypto.randomUUID();
  const storageKey = input.storageKey ?? `blob-object:${crypto.randomUUID()}`;
  const bytes = input.bytes ?? `encrypted-blob-bytes:${blobId}`;
  const bindingId = crypto.randomUUID();

  // Only seed the bytes + blob row the first time we see this blob/key. When a
  // blob is shared, the second call reuses the existing blob row and bytes.
  if (input.blobId === undefined) {
    await putBlobObjectBytes(storageKey, bytes);
    await db.insert(blobs).values({
      id: blobId,
      storageKey,
      sha256: `sha256:${blobId}`,
      byteLength: Buffer.byteLength(bytes, "utf8"),
    });
  }

  await db.insert(attachmentBindings).values({
    id: bindingId,
    documentId: input.documentId,
    slotId: input.slotId,
    blobId,
    documentManifestHash: input.documentManifestHash,
  });

  return { bindingId, blobId, storageKey };
}

interface DocumentRowPresence {
  readonly accessEvents: number;
  readonly accessManifestDocumentLinkProjection: number;
  readonly accessManifestHeads: number;
  readonly accessManifests: number;
  readonly currentDocumentLinks: number;
  readonly documentContentKeyEpochs: number;
  readonly documentContentKeyTargets: number;
  readonly documentContentWriteHeaders: number;
  readonly documentUpdates: number;
  readonly documents: number;
}

async function countDocumentRows(
  documentId: string,
): Promise<DocumentRowPresence> {
  const [
    documentRows,
    linkRows,
    manifestRows,
    manifestHeadRows,
    eventRows,
    epochRows,
    targetRows,
    writeHeaderRows,
    updateRows,
    linkProjectionRows,
  ] = await Promise.all([
    db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, documentId)),
    currentDocumentLinkRows(documentId),
    db
      .select({ manifestHash: accessManifests.manifestHash })
      .from(accessManifests)
      .where(
        and(
          eq(accessManifests.objectKind, "document"),
          eq(accessManifests.objectId, documentId),
        ),
      ),
    db
      .select({ manifestHash: accessManifestHeads.manifestHash })
      .from(accessManifestHeads)
      .where(
        and(
          eq(accessManifestHeads.objectKind, "document"),
          eq(accessManifestHeads.objectId, documentId),
        ),
      ),
    db
      .select({ eventHash: accessEvents.eventHash })
      .from(accessEvents)
      .where(
        and(
          eq(accessEvents.objectKind, "document"),
          eq(accessEvents.objectId, documentId),
        ),
      ),
    db
      .select({ id: documentContentKeyEpochs.id })
      .from(documentContentKeyEpochs)
      .where(eq(documentContentKeyEpochs.documentId, documentId)),
    db
      .select({ id: documentContentKeyTargets.id })
      .from(documentContentKeyTargets)
      .innerJoin(
        documentContentKeyEpochs,
        eq(
          documentContentKeyTargets.documentContentKeyEpochId,
          documentContentKeyEpochs.id,
        ),
      )
      .where(eq(documentContentKeyEpochs.documentId, documentId)),
    db
      .select({ updateId: documentContentWriteHeaders.updateId })
      .from(documentContentWriteHeaders)
      .where(eq(documentContentWriteHeaders.documentId, documentId)),
    db
      .select({ id: documentUpdates.id })
      .from(documentUpdates)
      .where(eq(documentUpdates.documentId, documentId)),
    db
      .select({ documentId: accessManifestDocumentLinkProjection.documentId })
      .from(accessManifestDocumentLinkProjection)
      .where(eq(accessManifestDocumentLinkProjection.documentId, documentId)),
  ]);

  return {
    accessEvents: eventRows.length,
    accessManifestDocumentLinkProjection: linkProjectionRows.length,
    accessManifestHeads: manifestHeadRows.length,
    accessManifests: manifestRows.length,
    currentDocumentLinks: linkRows.length,
    documentContentKeyEpochs: epochRows.length,
    documentContentKeyTargets: targetRows.length,
    documentContentWriteHeaders: writeHeaderRows.length,
    documentUpdates: updateRows.length,
    documents: documentRows.length,
  };
}

async function countTombstones(input: {
  readonly containerId: string;
  readonly documentId: string;
}): Promise<number> {
  const rows = await db
    .select({ id: containerDocumentSyncTombstones.id })
    .from(containerDocumentSyncTombstones)
    .where(
      and(
        eq(containerDocumentSyncTombstones.containerId, input.containerId),
        eq(containerDocumentSyncTombstones.documentId, input.documentId),
      ),
    );

  return rows.length;
}

test("document purge succeeds when event publication fails", async () => {
  const owner = createTestUser();
  const publishedEvents: Array<Record<string, unknown>> = [];
  const app = createRouteApp({
    runtime: createFailingRuntime((event) => publishedEvents.push(event)),
  });
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const before = await countDocumentRows(created.id);
  expect(before.documents).toBe(1);
  expect(before.currentDocumentLinks).toBe(1);
  expect(before.accessManifests).toBeGreaterThan(0);
  expect(before.accessEvents).toBeGreaterThan(0);
  expect(before.documentContentKeyEpochs).toBeGreaterThan(0);
  expect(before.documentContentKeyTargets).toBeGreaterThan(0);
  expect(before.accessManifestDocumentLinkProjection).toBeGreaterThan(0);

  const response = await postDocumentPurge({
    app,
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    owner,
    root,
    token: owner.token,
  });

  expect(response.status).toBe(200);
  const purged = await response.json();
  expect(isDocumentPurgeResponse(purged)).toBe(true);
  expect(purged.documentId).toBe(created.id);
  expect(typeof purged.purgedAt).toBe("string");
  expect(new Date(purged.purgedAt).toISOString()).toBe(purged.purgedAt);
  expect(purged.reclaimedBlobStorageKeys).toEqual([]);
  expect(publishedEvents).toHaveLength(1);

  const proofResponse = await app.request(`/documents/${created.id}/purge`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect(proofResponse.status).toBe(200);
  const proof = await proofResponse.json();
  expect(isDocumentPurgeProofResponse(proof)).toBe(true);
  expect(proof).toMatchObject({
    documentId: created.id,
    documentManifest: {
      manifestHash: created.manifestHash,
    },
    purgeEvent: purged.purgeEvent,
  });
  // The retained purge event keeps its signed dependency citation.
  expect(
    await db
      .select({
        dependencyManifestHashes: accessEvents.dependencyManifestHashes,
      })
      .from(accessEvents)
      .where(eq(accessEvents.eventHash, purged.purgeEvent.eventHash)),
  ).toEqual([{ dependencyManifestHashes: [root.bundle.manifestHash] }]);

  const after = await countDocumentRows(created.id);
  expect(after).toEqual({
    accessEvents: 2,
    accessManifestDocumentLinkProjection: 1,
    accessManifestHeads: 0,
    accessManifests: 1,
    currentDocumentLinks: 0,
    documentContentKeyEpochs: 0,
    documentContentKeyTargets: 0,
    documentContentWriteHeaders: 0,
    documentUpdates: 0,
    documents: 0,
  });

  expect(
    await countTombstones({
      containerId: root.kekState.containerId,
      documentId: created.id,
    }),
  ).toBe(1);
});

test("purge proof retrieval rejects a database-tampered terminal event", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const purgeResponse = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    owner,
    root,
    token: owner.token,
  });
  expect(purgeResponse.status).toBe(200);

  await db
    .update(accessEvents)
    .set({
      body: {
        containerId: root.kekState.containerId,
        containerManifestHash: root.bundle.manifestHash,
        documentManifestHash: "f".repeat(64),
        eventType: "document.purge",
      },
    })
    .where(
      and(
        eq(accessEvents.eventType, "document.purge"),
        eq(accessEvents.objectId, created.id),
      ),
    );

  const proofResponse = await routeApp.request(
    `/documents/${created.id}/purge`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(proofResponse.status).not.toBe(200);
  expect(await proofResponse.json()).toEqual({
    error: "access event body hash does not match body",
  });
});

test("POST document purge rejects a document linked to more than one container", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const created = await createDocument({ owner, root });
  await linkDocumentToSecondContainer({
    child,
    createdDocument: created,
    owner,
    root,
  });

  const before = await countDocumentRows(created.id);
  expect(before.documents).toBe(1);
  expect(before.currentDocumentLinks).toBe(2);

  const response = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    owner,
    root,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error:
      "Document must be linked to a single container before it can be purged",
  });

  // Nothing was deleted: the full per-document footprint is unchanged.
  const after = await countDocumentRows(created.id);
  expect(after).toEqual(before);
  expect(
    await countTombstones({
      containerId: root.kekState.containerId,
      documentId: created.id,
    }),
  ).toBe(0);
});

test("POST document purge rejects callers without container write access", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerAndAuthenticate(owner);
  await registerAndAuthenticate(outsider);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const response = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    owner,
    root,
    token: outsider.token,
  });

  expect([403, 404]).toContain(response.status);

  const after = await countDocumentRows(created.id);
  expect(after.documents).toBe(1);
  expect(after.currentDocumentLinks).toBe(1);
  expect(after.accessManifests).toBeGreaterThan(0);
  expect(after.documentContentKeyEpochs).toBeGreaterThan(0);
  expect(
    await countTombstones({
      containerId: root.kekState.containerId,
      documentId: created.id,
    }),
  ).toBe(0);
});

test("POST document purge returns 404 for an unknown document id", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);

  const response = await postDocumentPurge({
    documentId: crypto.randomUUID(),
    documentManifestHash: "0".repeat(64),
    owner,
    root,
    token: owner.token,
  });

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Document not found" });
});

test("POST document purge soft-deletes an orphaned blob and retains its bytes", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const attachment = await seedExternalBlobAttachment({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    slotId: "slot_purge_image",
  });

  expect(
    await readBlobObjectText(
      getDefaultApiServiceRuntime().blobObjectStore,
      attachment.storageKey,
    ),
  ).not.toBeNull();

  const response = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    owner,
    root,
    token: owner.token,
  });

  expect(response.status).toBe(200);
  const purged = await response.json();
  expect(isDocumentPurgeResponse(purged)).toBe(true);
  // Bytes are retained for a later GC sweep, not reclaimed synchronously: a
  // concurrent bind to a shared blob is a phantom this purge cannot see, so the
  // irreversible byte deletion is deferred until reachability is re-checked.
  expect(purged.reclaimedBlobStorageKeys).toEqual([]);

  // The blob row survives, soft-deleted with dereferencedAt stamped.
  const blobRows = await db
    .select({ id: blobs.id, dereferencedAt: blobs.dereferencedAt })
    .from(blobs)
    .where(eq(blobs.id, attachment.blobId));
  expect(blobRows).toHaveLength(1);
  expect(blobRows[0]?.dereferencedAt).not.toBeNull();

  // The purged document's own binding is gone.
  const bindingRows = await db
    .select({ id: attachmentBindings.id })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.blobId, attachment.blobId));
  expect(bindingRows).toHaveLength(0);

  // The encrypted bytes are still present in the object store.
  expect(
    await readBlobObjectText(
      getDefaultApiServiceRuntime().blobObjectStore,
      attachment.storageKey,
    ),
  ).not.toBeNull();
});

test("POST document purge preserves a blob shared with another document", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const documentToPurge = await createDocument({ owner, root });
  const survivingDocument = await createDocument({ owner, root });

  // Bind the same blob (and the same object-store bytes) to both documents.
  const shared = await seedExternalBlobAttachment({
    documentId: documentToPurge.id,
    documentManifestHash: documentToPurge.manifestHash,
    slotId: "slot_shared_image",
  });
  await seedExternalBlobAttachment({
    documentId: survivingDocument.id,
    documentManifestHash: survivingDocument.manifestHash,
    slotId: "slot_shared_image",
    blobId: shared.blobId,
    storageKey: shared.storageKey,
  });

  const response = await postDocumentPurge({
    documentId: documentToPurge.id,
    documentManifestHash: documentToPurge.manifestHash,
    owner,
    root,
    token: owner.token,
  });

  expect(response.status).toBe(200);
  const purged = await response.json();
  expect(isDocumentPurgeResponse(purged)).toBe(true);
  // The blob still has an active binding on the surviving document, so its
  // bytes must not be reclaimed.
  expect(purged.reclaimedBlobStorageKeys).toEqual([]);

  // The purged document's own binding is gone, but the blob row survives.
  const purgedDocumentBindings = await db
    .select({ id: attachmentBindings.id })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.documentId, documentToPurge.id));
  expect(purgedDocumentBindings).toHaveLength(0);

  const survivingBindings = await db
    .select({ id: attachmentBindings.id })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.documentId, survivingDocument.id));
  expect(survivingBindings).toHaveLength(1);

  const blobRows = await db
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, shared.blobId));
  expect(blobRows).toHaveLength(1);

  expect(
    await readBlobObjectText(
      getDefaultApiServiceRuntime().blobObjectStore,
      shared.storageKey,
    ),
  ).not.toBeNull();
});

// Simulate a replace/detach that retains its binding as history.
async function markBindingDetached(bindingId: string): Promise<void> {
  await db
    .update(attachmentBindings)
    .set({ detachedAt: new Date("2026-06-01T00:00:00.000Z") })
    .where(eq(attachmentBindings.id, bindingId));
}

// Seed the blob registry row a bind writes before live pruning.
async function seedBlobAuditObject(input: {
  readonly blobId: string;
  readonly organizationId: string;
  readonly storageKey: string;
}): Promise<void> {
  await db
    .insert(blobAuditObjects)
    .values({
      blobId: input.blobId,
      sha256: `sha256:${input.blobId}`,
      byteLength: 16,
      liveStorageKey: input.storageKey,
      organizationId: input.organizationId,
      retentionMode: "live_only",
      historicalBytesRetained: false,
    })
    .onConflictDoNothing();
}

// Detached bindings and the blob registry retain metadata, not live blob
// bytes. A purge that removes the final active binding starts the GC grace
// clock even if another document's detached binding still names the blob.
test("POST document purge dereferences a blob retained only in another document's history", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const documentToPurge = await createDocument({ owner, root });
  const survivingDocument = await createDocument({ owner, root });

  // The blob is actively bound on the document we purge...
  const shared = await seedExternalBlobAttachment({
    documentId: documentToPurge.id,
    documentManifestHash: documentToPurge.manifestHash,
    slotId: "slot_shared_image",
  });
  // ...and only retained as a detached binding on the surviving document.
  const survivingBinding = await seedExternalBlobAttachment({
    documentId: survivingDocument.id,
    documentManifestHash: survivingDocument.manifestHash,
    slotId: "slot_shared_image",
    blobId: shared.blobId,
    storageKey: shared.storageKey,
  });
  await markBindingDetached(survivingBinding.bindingId);
  await seedBlobAuditObject({
    blobId: shared.blobId,
    organizationId: asVerifiedContainerManifest(root.bundle).state
      .organizationId,
    storageKey: shared.storageKey,
  });

  const response = await postDocumentPurge({
    documentId: documentToPurge.id,
    documentManifestHash: documentToPurge.manifestHash,
    owner,
    root,
    token: owner.token,
  });

  expect(response.status).toBe(200);
  const purged = await response.json();
  expect(isDocumentPurgeResponse(purged)).toBe(true);
  expect(purged.reclaimedBlobStorageKeys).toEqual([]);

  const blobRows = await db
    .select({ dereferencedAt: blobs.dereferencedAt, id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, shared.blobId));
  expect(blobRows).toHaveLength(1);
  expect(blobRows[0]?.dereferencedAt).toBeInstanceOf(Date);

  const auditObjectRows = await db
    .select({ blobId: blobAuditObjects.blobId })
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, shared.blobId));
  expect(auditObjectRows).toHaveLength(1);

  // Physical deletion is delayed until the GC grace period expires.
  expect(
    await readBlobObjectText(
      getDefaultApiServiceRuntime().blobObjectStore,
      shared.storageKey,
    ),
  ).not.toBeNull();
});

// Regression for the replace-then-purge leak (issue #1041 / scrub finding #8):
// a blob whose only remaining references are this document's own DETACHED
// bindings (e.g. left behind by a replace) must be reclaimed on purge. The old
// candidate set considered only ACTIVE bindings, so such blobs leaked forever.
test("POST document purge soft-deletes detached document-only blobs", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  // Original blob, later "replaced": its binding is detached but retained.
  const replaced = await seedExternalBlobAttachment({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    slotId: "slot_replaced_image",
  });
  await markBindingDetached(replaced.bindingId);
  // The current blob occupying the slot after the replace.
  const current = await seedExternalBlobAttachment({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    slotId: "slot_replaced_image",
  });

  const response = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    owner,
    root,
    token: owner.token,
  });

  expect(response.status).toBe(200);
  const purged = await response.json();
  expect(isDocumentPurgeResponse(purged)).toBe(true);
  // Both the replaced (detached) and current blobs were referenced only by this
  // document, so both are orphaned — soft-deleted with bytes retained, nothing
  // reclaimed synchronously.
  expect(purged.reclaimedBlobStorageKeys).toEqual([]);

  for (const blobId of [replaced.blobId, current.blobId]) {
    const blobRows = await db
      .select({ id: blobs.id, dereferencedAt: blobs.dereferencedAt })
      .from(blobs)
      .where(eq(blobs.id, blobId));
    expect(blobRows).toHaveLength(1);
    expect(blobRows[0]?.dereferencedAt).not.toBeNull();
  }
  for (const storageKey of [replaced.storageKey, current.storageKey]) {
    expect(
      await readBlobObjectText(
        getDefaultApiServiceRuntime().blobObjectStore,
        storageKey,
      ),
    ).not.toBeNull();
  }
});

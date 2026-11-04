import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobAuditObjects,
  blobs,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { isDocumentPurgeResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  readBlobObjectText,
  uploadBlobObject,
} from "../../../test/helpers/blobObjectStore";
import { postDocumentPurge } from "../../../test/helpers/documentPurge";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";
import { getDefaultApiServiceRuntime } from "../../services/runtime";

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

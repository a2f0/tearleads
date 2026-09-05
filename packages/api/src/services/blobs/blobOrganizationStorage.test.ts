import { expect, test } from "bun:test";
import {
  blobAuditObjects,
  blobStages,
  blobs,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  buildBind,
  buildDetach,
} from "../../../test/helpers/blobAttachmentKit";
import { readBlobObjectText } from "../../../test/helpers/blobObjectStore";
import { createBlobStageOwner } from "../../../test/helpers/blobStageOwner";
import { createFakeS3BlobObjectStore } from "../../../test/helpers/fakeS3BlobObjectStore";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { addOrganizationMember } from "../../../test/helpers/organizationMembership";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { createMemoryBlobObjectStore } from "../../adapters/blobObjectStore";
import { sha256Hex } from "../../utils/sha256";
import type { ApiServiceRuntime } from "../runtime";
import { reclaimDereferencedBlobs } from "./blobMaintenance";
import { bindBlobAttachment, detachBlobAttachment } from "./blobMutations";
import { getBlobBytes } from "./getBlob";
import {
  cleanupExpiredBlobStages,
  completeMultipartBlobStage,
  initiateMultipartBlobStage,
  uploadMultipartBlobPartBytes,
} from "./multipartStage";

const bytes = new TextEncoder().encode(
  "same encrypted bytes in two organizations",
);

async function stageBytes(
  runtime: ApiServiceRuntime,
  input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly complete?: boolean;
  },
) {
  const metadata = { byteLength: bytes.byteLength, sha256: sha256Hex(bytes) };
  const stage = await initiateMultipartBlobStage(runtime, {
    ...metadata,
    ...input,
  });
  const key = `organizations/${input.organizationId}/blob-stages/${stage.stageId}`;
  expect(stage.organizationId).toBe(input.organizationId);
  if (input.complete !== false) {
    const part = await uploadMultipartBlobPartBytes(runtime, {
      ...metadata,
      bytes,
      partNumber: 1,
      stageId: stage.stageId,
      uploadId: stage.uploadId,
      userId: input.userId,
    });
    const completed = await completeMultipartBlobStage(runtime, {
      parts: [{ etag: part.part.etag, partNumber: 1 }],
      stageId: stage.stageId,
      uploadId: stage.uploadId,
      userId: input.userId,
    });
    expect(completed.organizationId).toBe(input.organizationId);
  }
  return { ...stage, key };
}

test("stage creation checks organization access before creating an object-store upload", async () => {
  const owner = await createBlobStageOwner();
  const outsider = await createBlobStageOwner();
  const runtime = createServiceTestRuntime();
  let createdUploads = 0;
  const store = runtime.blobObjectStore;
  runtime.blobObjectStore = {
    ...store,
    createMultipartUpload: async (input) => {
      createdUploads += 1;
      return store.createMultipartUpload(input);
    },
  };
  await expect(
    stageBytes(runtime, {
      organizationId: owner.organizationId,
      userId: outsider.userId,
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(createdUploads).toBe(0);
});

test("a user in both organizations cannot promote a stage into the other organization", async () => {
  const first = await createBlobStageOwner();
  const second = await createBlobStageOwner();
  await authenticate(first.owner);
  await authenticate(second.owner);
  await addOrganizationMember({
    actor: second.owner,
    member: first.owner,
    organizationId: second.organizationId,
  });
  const root = await bootstrapRoot(first.owner);
  const document = await createDocument({ owner: first.owner, root });
  const runtime = createServiceTestRuntime();
  const staged = await stageBytes(runtime, {
    userId: first.userId,
    organizationId: second.organizationId,
  });
  const blobId = crypto.randomUUID();
  const bind = await buildBind({
    blobId,
    document,
    owner: first.owner,
    root,
    stagedBlob: staged,
  });
  await expect(
    bindBlobAttachment(runtime, {
      blobId,
      fingerprint: first.owner.fingerprint,
      request: bind.request,
      sessionId: "organization-storage",
      userId: first.userId,
    }),
  ).rejects.toMatchObject({ status: 404, message: "Blob stage not found" });
  expect(
    await runtime.db.select().from(blobs).where(eq(blobs.id, blobId)),
  ).toEqual([]);
  expect(await readBlobObjectText(runtime.blobObjectStore, staged.key)).toBe(
    new TextDecoder().decode(bytes),
  );
  expect(
    await runtime.db
      .select()
      .from(blobStages)
      .where(eq(blobStages.id, staged.stageId)),
  ).toHaveLength(1);
});

test("promotion, reads, and GC retries retain the organization key and preserve another organization's bytes", async () => {
  const first = await createBlobStageOwner();
  const second = await createBlobStageOwner();
  await authenticate(first.owner);
  const root = await bootstrapRoot(first.owner);
  const document = await createDocument({ owner: first.owner, root });
  const runtime = createServiceTestRuntime(undefined, {
    blobObjectStore: createFakeS3BlobObjectStore().store,
  });
  const staged = await stageBytes(runtime, first);
  const other = await stageBytes(runtime, second);
  const blobId = crypto.randomUUID();
  const bind = await buildBind({
    blobId,
    document,
    owner: first.owner,
    root,
    stagedBlob: staged,
  });
  await bindBlobAttachment(runtime, {
    blobId,
    fingerprint: first.owner.fingerprint,
    request: bind.request,
    sessionId: "organization-storage",
    userId: first.userId,
  });
  const [blob] = await runtime.db
    .select()
    .from(blobs)
    .where(eq(blobs.id, blobId));
  expect(blob?.storageKey).toBe(staged.key);
  const read = await getBlobBytes(runtime, { blobId, userId: first.userId });
  expect(await new Response(read.encryptedBytes).text()).toBe(
    new TextDecoder().decode(bytes),
  );
  await detachBlobAttachment(runtime, {
    bindingId: bind.binding.bindingId,
    blobId,
    fingerprint: first.owner.fingerprint,
    request: await buildDetach({
      binding: bind.binding,
      document,
      owner: first.owner,
      root,
    }),
    sessionId: "organization-storage",
    userId: first.userId,
  });
  const deletedKeys: string[] = [];
  const store = runtime.blobObjectStore;
  let failDelete = true;
  runtime.blobObjectStore = {
    ...store,
    deleteObject: async (key) => {
      deletedKeys.push(key);
      if (failDelete) throw new Error("object store unavailable");
      await store.deleteObject(key);
    },
  };
  const gc = {
    blobIds: [blobId],
    gracePeriodMs: 0,
    now: new Date(Date.now() + 1000),
  };
  await expect(reclaimDereferencedBlobs(runtime, gc)).rejects.toBeInstanceOf(
    AggregateError,
  );
  const [pending] = await runtime.db
    .select()
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, blobId));
  expect(pending).toMatchObject({
    organizationId: first.organizationId,
    liveStorageKey: staged.key,
    objectDeletedAt: null,
  });
  expect(pending?.prunedAt).toBeInstanceOf(Date);
  failDelete = false;
  expect((await reclaimDereferencedBlobs(runtime, gc)).deletedObjectCount).toBe(
    1,
  );
  expect(deletedKeys).toEqual([staged.key, staged.key]);
  expect(await readBlobObjectText(store, staged.key)).toBeNull();
  expect(await readBlobObjectText(store, other.key)).toBe(
    new TextDecoder().decode(bytes),
  );
});

test("expiry cleanup aborts and deletes namespaced stages while retaining unexpired stages", async () => {
  const first = await createBlobStageOwner();
  const second = await createBlobStageOwner();
  const runtime = createServiceTestRuntime();
  const pending = await stageBytes(runtime, { ...first, complete: false });
  const completed = await stageBytes(runtime, first);
  const retained = await stageBytes(runtime, second);
  const store = runtime.blobObjectStore;
  const aborted: string[] = [];
  const deleted: string[] = [];
  runtime.blobObjectStore = {
    ...store,
    abortMultipartUpload: async (input) => {
      aborted.push(input.key);
      return store.abortMultipartUpload(input);
    },
    deleteObject: async (key) => {
      deleted.push(key);
      await store.deleteObject(key);
    },
  };
  for (const stage of [pending, completed]) {
    await runtime.db
      .update(blobStages)
      .set({ expiresAt: new Date(0) })
      .where(eq(blobStages.id, stage.stageId));
  }
  const summary = await cleanupExpiredBlobStages(runtime, { now: new Date(1) });
  expect(summary).toMatchObject({
    abortedMultipartUploads: 1,
    deletedMultipartObjects: 1,
    deletedStages: 2,
    failedStages: 0,
  });
  expect(aborted).toEqual([pending.key]);
  expect(deleted).toEqual([completed.key]);
  expect(await readBlobObjectText(store, retained.key)).toBe(
    new TextDecoder().decode(bytes),
  );
});

test("initiateMultipartBlobStage aborts the upload when stage persistence fails", async () => {
  const store = createMemoryBlobObjectStore();
  const aborted: { readonly key: string; readonly uploadId: string }[] = [];
  const runtime = createServiceTestRuntime(undefined, {
    blobObjectStore: {
      ...store,
      abortMultipartUpload: async (input) => {
        aborted.push(input);
        await store.abortMultipartUpload(input);
      },
    },
  });
  const { userId, organizationId } = await createBlobStageOwner();
  const insertError = new Error("insert failed");
  runtime.db = {
    select: runtime.db.select.bind(runtime.db),
    transaction: async () => {
      throw insertError;
    },
  } as unknown as typeof runtime.db;

  await expect(
    initiateMultipartBlobStage(runtime, {
      organizationId,
      byteLength: bytes.byteLength,
      sha256: sha256Hex(bytes),
      userId,
    }),
  ).rejects.toBe(insertError);
  expect(aborted).toHaveLength(1);
  const abortedUpload = aborted[0];
  expect(abortedUpload).toBeDefined();
  await expect(
    store.createMultipartUpload({ key: abortedUpload?.key ?? "missing" }),
  ).resolves.toHaveProperty("uploadId");
});

import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { attachmentBindings, blobs } from "@symcrypt/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  markBlobDereferencedIfInactive,
  reviveBlobIfDereferenced,
} from "./persistence";

async function insertBlob(input: {
  readonly id: string;
  readonly dereferencedAt: Date | null;
  readonly reclaimAttemptedAt?: Date | null;
  readonly storageKey?: string;
}): Promise<void> {
  await db.insert(blobs).values({
    id: input.id,
    storageKey: input.storageKey ?? `blob-object:${input.id}`,
    sha256: `sha256:${input.id}`,
    byteLength: 1,
    dereferencedAt: input.dereferencedAt,
    reclaimAttemptedAt: input.reclaimAttemptedAt,
  });
}

async function readDereferencedAt(id: string): Promise<Date | null> {
  const [row] = await db
    .select({ dereferencedAt: blobs.dereferencedAt })
    .from(blobs)
    .where(eq(blobs.id, id))
    .limit(1);
  return row?.dereferencedAt ?? null;
}

test("reviveBlobIfDereferenced clears a soft-deleted blob's marker", async () => {
  const blobId = crypto.randomUUID();
  await insertBlob({
    id: blobId,
    dereferencedAt: new Date(),
    reclaimAttemptedAt: new Date(),
  });

  await db.transaction((tx) =>
    reviveBlobIfDereferenced({ blobId, executor: tx }),
  );

  // A bind re-references the blob, so a prior purge's soft-delete is cleared and
  // the GC sweep will not reclaim it.
  expect(await readDereferencedAt(blobId)).toBeNull();
  const [row] = await db
    .select({ reclaimAttemptedAt: blobs.reclaimAttemptedAt })
    .from(blobs)
    .where(eq(blobs.id, blobId));
  expect(row?.reclaimAttemptedAt).toBeNull();
});

test("reviveBlobIfDereferenced is a no-op for a live blob", async () => {
  const blobId = crypto.randomUUID();
  await insertBlob({ id: blobId, dereferencedAt: null });

  await db.transaction((tx) =>
    reviveBlobIfDereferenced({ blobId, executor: tx }),
  );

  expect(await readDereferencedAt(blobId)).toBeNull();
});

test("markBlobDereferencedIfInactive starts the grace clock after the final detach", async () => {
  const blobId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  await insertBlob({ id: blobId, dereferencedAt: null });
  await db.insert(attachmentBindings).values({
    blobId,
    documentId: crypto.randomUUID(),
    id: bindingId,
    slotId: "slot_grace_clock",
  });

  await db.transaction((tx) =>
    markBlobDereferencedIfInactive({ blobId, executor: tx }),
  );
  expect(await readDereferencedAt(blobId)).toBeNull();

  await db
    .update(attachmentBindings)
    .set({ detachedAt: new Date() })
    .where(eq(attachmentBindings.id, bindingId));
  await db.transaction((tx) =>
    markBlobDereferencedIfInactive({ blobId, executor: tx }),
  );
  expect(await readDereferencedAt(blobId)).toBeInstanceOf(Date);
});

test("a second blob row aliasing one object-store key is rejected (unique storage_key)", async () => {
  // Two concurrent binds promoting the same stage to different blobIds would
  // otherwise create two blob rows over one object key, breaking storage-key GC.
  // The unique index makes the loser fail closed.
  const storageKey = `blob-object:${crypto.randomUUID()}`;
  await insertBlob({
    id: crypto.randomUUID(),
    dereferencedAt: null,
    storageKey,
  });

  await expect(
    insertBlob({ id: crypto.randomUUID(), dereferencedAt: null, storageKey }),
  ).rejects.toThrow();
});

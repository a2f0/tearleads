import { expect, test } from "bun:test";
import { createBlobStore } from "@tearleads/client-sdk/data/blobs/createBlobStore";

test("createBlobStore reuses stores per namespace and isolates different namespaces", async () => {
  const namespaceA = crypto.randomUUID();
  const namespaceB = crypto.randomUUID();
  const storageKey = crypto.randomUUID();
  const bytes = new Uint8Array([1, 2, 3]);

  const blobStoreA = createBlobStore(namespaceA);
  const blobStoreAAgain = createBlobStore(namespaceA);
  const blobStoreB = createBlobStore(namespaceB);

  expect(blobStoreA).toBe(blobStoreAAgain);
  expect(blobStoreA).not.toBe(blobStoreB);

  await blobStoreA.writeBytes(storageKey, bytes);

  await expect(blobStoreA.readBytes(storageKey)).resolves.toEqual(bytes);
  await expect(blobStoreB.readBytes(storageKey)).resolves.toBeNull();
});

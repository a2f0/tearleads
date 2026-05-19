import { expect, test } from "bun:test";
import { readBlobObjectText } from "../../test/helpers/blobObjectStore";
import { sha256Hex } from "../utils/sha256";
import { createMemoryBlobObjectStore } from "./blobObjectStore";

test("memory blob object store completes multipart uploads by part number", async () => {
  const store = createMemoryBlobObjectStore();
  const key = "blob-stages/out-of-order-completion";
  const { uploadId } = await store.createMultipartUpload({ key });
  const secondPart = await store.uploadPart({
    bytes: "-second",
    key,
    partNumber: 2,
    uploadId,
  });
  const firstPart = await store.uploadPart({
    bytes: "first",
    key,
    partNumber: 1,
    uploadId,
  });

  const completed = await store.completeMultipartUpload({
    expected: {
      byteLength: new TextEncoder().encode("first-second").byteLength,
      sha256: await sha256Hex("first-second"),
    },
    key,
    parts: [
      { etag: secondPart.etag, partNumber: 2 },
      { etag: firstPart.etag, partNumber: 1 },
    ],
    uploadId,
  });

  expect(await readBlobObjectText(store, key)).toBe("first-second");
  const objectStream = await store.getObjectStream(key);
  expect(objectStream).not.toBeNull();
  if (!objectStream) {
    throw new Error("Expected completed object stream");
  }
  expect(await new Response(objectStream).text()).toBe("first-second");
  expect(completed).toEqual({
    byteLength: new TextEncoder().encode("first-second").byteLength,
    sha256: await sha256Hex("first-second"),
  });
});

test("memory blob object store releases multipart key conflicts after terminal states", async () => {
  const store = createMemoryBlobObjectStore();
  const abortedKey = "blob-stages/aborted-conflict";
  const abortedUpload = await store.createMultipartUpload({ key: abortedKey });

  await expect(
    store.createMultipartUpload({ key: abortedKey }),
  ).rejects.toThrow("Multipart upload already exists");
  await store.abortMultipartUpload({
    key: abortedKey,
    uploadId: abortedUpload.uploadId,
  });
  await expect(
    store.createMultipartUpload({ key: abortedKey }),
  ).resolves.toHaveProperty("uploadId");

  const completedKey = "blob-stages/completed-conflict";
  const completedUpload = await store.createMultipartUpload({
    key: completedKey,
  });
  const part = await store.uploadPart({
    bytes: "complete",
    key: completedKey,
    partNumber: 1,
    uploadId: completedUpload.uploadId,
  });
  await store.completeMultipartUpload({
    expected: {
      byteLength: new TextEncoder().encode("complete").byteLength,
      sha256: await sha256Hex("complete"),
    },
    key: completedKey,
    parts: [{ etag: part.etag, partNumber: 1 }],
    uploadId: completedUpload.uploadId,
  });

  await expect(
    store.createMultipartUpload({ key: completedKey }),
  ).resolves.toHaveProperty("uploadId");
});

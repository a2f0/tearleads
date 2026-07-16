import { expect, test } from "bun:test";
import {
  blobObjectBytes,
  readBlobObjectText,
} from "../../test/helpers/blobObjectStore";
import { sha256Hex } from "../utils/sha256";
import { createMemoryBlobObjectStore } from "./blobObjectStore";

test("memory blob object store completes multipart uploads by part number", async () => {
  const store = createMemoryBlobObjectStore();
  const key = "blob-stages/out-of-order-completion";
  const { uploadId } = await store.createMultipartUpload({ key });
  const secondPart = await store.uploadPart({
    body: {
      byteLength: 7,
      bytes: blobObjectBytes("-second"),
      sha256: await sha256Hex("-second"),
    },
    key,
    partNumber: 2,
    uploadId,
  });
  const firstPart = await store.uploadPart({
    body: {
      byteLength: 5,
      bytes: blobObjectBytes("first"),
      sha256: await sha256Hex("first"),
    },
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

test("memory blob object store accepts streamed multipart parts", async () => {
  const store = createMemoryBlobObjectStore();
  const key = "blob-stages/streamed-memory-part";
  const bytes = "streamed-memory";
  const { uploadId } = await store.createMultipartUpload({ key });
  const part = await store.uploadPart({
    body: {
      byteLength: new TextEncoder().encode(bytes).byteLength,
      bytes: blobObjectBytes(bytes),
      sha256: await sha256Hex(bytes),
    },
    key,
    partNumber: 1,
    uploadId,
  });

  await store.completeMultipartUpload({
    expected: {
      byteLength: new TextEncoder().encode(bytes).byteLength,
      sha256: await sha256Hex(bytes),
    },
    key,
    parts: [{ etag: part.etag, partNumber: 1 }],
    uploadId,
  });

  expect(await readBlobObjectText(store, key)).toBe(bytes);
});

test("memory blob object store preserves arbitrary binary multipart bytes", async () => {
  const store = createMemoryBlobObjectStore();
  const key = "blob-stages/streamed-memory-binary";
  const firstBytes = new Uint8Array([0x00, 0xff, 0xc3, 0x28]);
  const secondBytes = new Uint8Array([0x80, 0x00, 0xfe, 0x7f]);
  const expectedBytes = new Uint8Array([...firstBytes, ...secondBytes]);
  const { uploadId } = await store.createMultipartUpload({ key });
  const firstPart = await store.uploadPart({
    body: {
      byteLength: firstBytes.byteLength,
      bytes: blobObjectBytes(firstBytes),
      sha256: await sha256Hex(firstBytes),
    },
    key,
    partNumber: 1,
    uploadId,
  });
  const secondPart = await store.uploadPart({
    body: {
      byteLength: secondBytes.byteLength,
      bytes: blobObjectBytes(secondBytes),
      sha256: await sha256Hex(secondBytes),
    },
    key,
    partNumber: 2,
    uploadId,
  });

  const completed = await store.completeMultipartUpload({
    expected: {
      byteLength: expectedBytes.byteLength,
      sha256: await sha256Hex(expectedBytes),
    },
    key,
    parts: [
      { etag: firstPart.etag, partNumber: 1 },
      { etag: secondPart.etag, partNumber: 2 },
    ],
    uploadId,
  });
  const storedStream = await store.getObjectStream(key);

  expect(storedStream).not.toBeNull();
  if (!storedStream) {
    throw new Error("Expected completed binary object stream");
  }
  const storedBytes = new Uint8Array(
    await new Response(storedStream).arrayBuffer(),
  );
  expect(storedBytes).toEqual(expectedBytes);
  expect(completed).toEqual({
    byteLength: expectedBytes.byteLength,
    sha256: await sha256Hex(expectedBytes),
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
    body: {
      byteLength: 8,
      bytes: blobObjectBytes("complete"),
      sha256: await sha256Hex("complete"),
    },
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

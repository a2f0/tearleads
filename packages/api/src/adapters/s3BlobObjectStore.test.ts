import { expect, test } from "bun:test";
import {
  CompleteMultipartUploadCommand,
  GetObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import {
  blobObjectBytes,
  readBlobObjectText,
} from "../../test/helpers/blobObjectStore";
import {
  type CommandWithInput,
  createFakeS3BlobObjectStore,
  listPartNumbers,
} from "../../test/helpers/fakeS3BlobObjectStore";
import { sha256Hex } from "../utils/sha256";
import { BlobObjectStoreError } from "./blobObjectStore";
import { createS3BlobObjectStore } from "./s3BlobObjectStore";

test("S3 blob object store completes multipart uploads by part number", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  const { uploadId } = await store.createMultipartUpload({
    key: "blob-stages/s3-complete",
  });
  const secondPart = await store.uploadPart({
    body: {
      byteLength: 7,
      bytes: blobObjectBytes("-second"),
      sha256: await sha256Hex("-second"),
    },
    key: "blob-stages/s3-complete",
    partNumber: 2,
    uploadId,
  });
  const firstPart = await store.uploadPart({
    body: {
      byteLength: 5,
      bytes: blobObjectBytes("first"),
      sha256: await sha256Hex("first"),
    },
    key: "blob-stages/s3-complete",
    partNumber: 1,
    uploadId,
  });

  expect(
    listPartNumbers(
      await store.listParts({ key: "blob-stages/s3-complete", uploadId }),
    ),
  ).toEqual([1, 2]);
  const completed = await store.completeMultipartUpload({
    expected: {
      byteLength: Buffer.byteLength("first-second", "utf8"),
      sha256: await sha256Hex("first-second"),
    },
    key: "blob-stages/s3-complete",
    parts: [
      { etag: secondPart.etag, partNumber: 2 },
      { etag: firstPart.etag, partNumber: 1 },
    ],
    uploadId,
  });

  expect(
    client.commands.filter((command) => command instanceof GetObjectCommand),
  ).toHaveLength(1);
  expect(completed).toEqual({
    byteLength: Buffer.byteLength("first-second", "utf8"),
    sha256: await sha256Hex("first-second"),
  });
  const completeCommand = client.commands.find(
    (command) => command instanceof CompleteMultipartUploadCommand,
  ) as CommandWithInput | undefined;
  expect(completeCommand?.input.MultipartUpload).toEqual({
    Parts: [
      { ETag: firstPart.etag, PartNumber: 1 },
      { ETag: secondPart.etag, PartNumber: 2 },
    ],
  });
  // Completion is by part ETag only; the proprietary FULL_OBJECT whole-object
  // checksum flow (rejected by Garage and by AWS for SHA-256) must not be sent.
  expect(completeCommand?.input.MpuObjectSize).toBeUndefined();
  expect(completeCommand?.input.ChecksumSHA256).toBeUndefined();
  expect(completeCommand?.input.ChecksumType).toBeUndefined();
  expect(await readBlobObjectText(store, "blob-stages/s3-complete")).toBe(
    "first-second",
  );
});

test("S3 blob object store hashes completed binary multipart bytes", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  const key = "blob-stages/s3-streamed-part";
  const bytes = Uint8Array.from([0, 0xff, 0x80, 0x0a, 0x00, 0x41]);
  const { uploadId } = await store.createMultipartUpload({ key });
  const part = await store.uploadPart({
    body: {
      byteLength: bytes.byteLength,
      bytes,
      sha256: await sha256Hex(bytes),
    },
    key,
    partNumber: 1,
    uploadId,
  });

  const completed = await store.completeMultipartUpload({
    expected: {
      byteLength: 1,
      sha256: await sha256Hex("deliberately-wrong"),
    },
    key,
    parts: [{ etag: part.etag, partNumber: 1 }],
    uploadId,
  });

  expect(completed).toEqual({
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  });

  const uploadCommand = client.commands.find(
    (command) => command instanceof UploadPartCommand,
  ) as CommandWithInput | undefined;
  expect(typeof uploadCommand?.input.Body).not.toBe("string");
  const stored = await store.getObjectStream(key);
  expect(stored).not.toBeNull();
  if (!stored) {
    throw new Error("Expected completed binary object");
  }
  expect(new Uint8Array(await new Response(stored).arrayBuffer())).toEqual(
    bytes,
  );
});

test("S3 blob object store sends buffered part bytes with their byte length", async () => {
  // Regression guard: streaming the request body straight to the object store
  // segfaults Bun when the upload connection resets mid-part. The route buffers
  // the part with Bun's native body read and hands the bytes to the store, which
  // sends them as an in-memory Uint8Array (rewindable, so the SDK can retry a
  // reset part) with the byte length as the content length.
  const { client, store } = createFakeS3BlobObjectStore();
  const key = "blob-stages/s3-buffered-part";
  const bytes = "buffered-streamed-part";
  const { uploadId } = await store.createMultipartUpload({ key });

  const part = await store.uploadPart({
    body: {
      byteLength: Buffer.byteLength(bytes, "utf8"),
      bytes: blobObjectBytes(bytes),
      sha256: await sha256Hex(bytes),
    },
    key,
    partNumber: 1,
    uploadId,
  });

  const uploadCommand = client.commands.find(
    (command) => command instanceof UploadPartCommand,
  ) as CommandWithInput | undefined;
  expect(typeof uploadCommand?.input.Body).not.toBe("string");
  expect(uploadCommand?.input.Body).toBeInstanceOf(Uint8Array);
  expect(uploadCommand?.input.ContentLength).toBe(
    Buffer.byteLength(bytes, "utf8"),
  );

  await store.completeMultipartUpload({
    expected: {
      byteLength: Buffer.byteLength(bytes, "utf8"),
      sha256: await sha256Hex(bytes),
    },
    key,
    parts: [{ etag: part.etag, partNumber: 1 }],
    uploadId,
  });
  expect(await readBlobObjectText(store, key)).toBe(bytes);
});

test("S3 blob object store rejects a part whose bytes mismatch the declared length", async () => {
  // The declared byte-length header must match the bytes the route buffered; a
  // mismatch means a truncated or corrupt part and is rejected before upload.
  const { store } = createFakeS3BlobObjectStore();
  const key = "blob-stages/s3-mismatched-part";
  const bytes = "buffered-streamed-part";
  const { uploadId } = await store.createMultipartUpload({ key });

  await expect(
    store.uploadPart({
      body: {
        byteLength: 4,
        bytes: blobObjectBytes(bytes),
        sha256: await sha256Hex(bytes),
      },
      key,
      partNumber: 1,
      uploadId,
    }),
  ).rejects.toThrow(/byteLength mismatch/);
});

test("S3 blob object store rejects a part declared above the size ceiling", async () => {
  // A part declaring more than the ceiling is rejected up front, before the
  // declared length is compared against the buffered bytes.
  const { store } = createFakeS3BlobObjectStore();
  const key = "blob-stages/s3-huge-part";
  const { uploadId } = await store.createMultipartUpload({ key });

  await expect(
    store.uploadPart({
      body: {
        byteLength: 200 * 1024 * 1024,
        bytes: blobObjectBytes("unused"),
        sha256: await sha256Hex("unused"),
      },
      key,
      partNumber: 1,
      uploadId,
    }),
  ).rejects.toThrow(/exceeds the maximum/);
});

test("S3 blob object store rejects an out-of-range part number before buffering", async () => {
  // An invalid part number must fail on the number, not after draining the
  // (upload-sized) body — proving the guard runs before the stream is read.
  const { store } = createFakeS3BlobObjectStore();
  const key = "blob-stages/s3-bad-part-number";
  const bytes = "buffered-streamed-part";
  const { uploadId } = await store.createMultipartUpload({ key });

  await expect(
    store.uploadPart({
      body: {
        byteLength: Buffer.byteLength(bytes, "utf8"),
        bytes: blobObjectBytes(bytes),
        sha256: await sha256Hex(bytes),
      },
      key,
      partNumber: 10_001,
      uploadId,
    }),
  ).rejects.toThrow(/Invalid multipart part number/);
});

test("S3 blob object store follows list parts pagination", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  client.listPartsPageSize = 1;
  const { uploadId } = await store.createMultipartUpload({
    key: "blob-stages/s3-paginated-list",
  });
  await store.uploadPart({
    body: {
      byteLength: 5,
      bytes: blobObjectBytes("first"),
      sha256: await sha256Hex("first"),
    },
    key: "blob-stages/s3-paginated-list",
    partNumber: 1,
    uploadId,
  });
  await store.uploadPart({
    body: {
      byteLength: 6,
      bytes: blobObjectBytes("second"),
      sha256: await sha256Hex("second"),
    },
    key: "blob-stages/s3-paginated-list",
    partNumber: 2,
    uploadId,
  });

  expect(
    listPartNumbers(
      await store.listParts({
        key: "blob-stages/s3-paginated-list",
        uploadId,
      }),
    ),
  ).toEqual([1, 2]);
  expect(
    client.commands.filter((command) => command instanceof ListPartsCommand),
  ).toHaveLength(2);
});

test("S3 blob object store maps missing objects to null", async () => {
  const { store } = createFakeS3BlobObjectStore();

  await expect(
    store.getObjectStream("blob-stages/missing"),
  ).resolves.toBeNull();
});

test("S3 blob object store proves multipart absence only from NoSuchUpload", async () => {
  const { store } = createFakeS3BlobObjectStore();

  await expect(
    store.listParts({
      key: "blob-stages/missing-upload",
      uploadId: "upload-missing",
    }),
  ).rejects.toMatchObject({
    code: "multipart_upload_not_found",
  });
});

test("S3 blob object store preserves ambiguous 404 failures", async () => {
  const ambiguousError = Object.assign(new Error("No such bucket"), {
    $metadata: { httpStatusCode: 404 },
    name: "NoSuchBucket",
  });
  const store = createS3BlobObjectStore({
    bucket: "missing-bucket",
    client: {
      send: async () => {
        throw ambiguousError;
      },
    },
  });

  await expect(
    store.listParts({
      key: "blob-stages/ambiguous",
      uploadId: "upload-ambiguous",
    }),
  ).rejects.toBe(ambiguousError);
  await expect(store.getObjectStream("blob-stages/ambiguous")).rejects.toBe(
    ambiguousError,
  );
});

test("S3 blob object store rejects string object bodies", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  client.objectBodies.set("blob-stages/string-body", "legacy-text-body");

  await expect(
    store.getObjectStream("blob-stages/string-body"),
  ).rejects.toThrow("Unsupported S3 object body type");
});

test("S3 blob object store rejects string-only SDK body transforms", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  let transformToStringCalls = 0;
  client.objectBodies.set("blob-stages/transform", {
    transformToString: async () => {
      transformToStringCalls += 1;
      return "from-transform";
    },
  });

  await expect(store.getObjectStream("blob-stages/transform")).rejects.toThrow(
    "Unsupported S3 object body type",
  );
  expect(transformToStringCalls).toBe(0);
});

test("S3 blob object store streams SDK web streams without string transforms", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  let transformToStringCalls = 0;
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("from-"));
      controller.enqueue(new TextEncoder().encode("stream"));
      controller.close();
    },
  });
  client.objectBodies.set("blob-stages/stream", {
    transformToString: async () => {
      transformToStringCalls += 1;
      return "from-transform";
    },
    transformToWebStream: () => source,
  });

  const stream = await store.getObjectStream("blob-stages/stream");

  expect(stream).not.toBeNull();
  if (!stream) {
    throw new Error("Expected S3 object stream");
  }
  await expect(new Response(stream).text()).resolves.toBe("from-stream");
  expect(transformToStringCalls).toBe(0);
  expect(source.locked).toBe(false);
});

test("S3 blob object store cancels source streams after conversion errors", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  let cancelReason: unknown;
  client.objectBodies.set(
    "blob-stages/bad-stream-chunk",
    new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue({ invalid: true });
      },
      cancel(reason) {
        cancelReason = reason;
      },
    }),
  );

  const stream = await store.getObjectStream("blob-stages/bad-stream-chunk");

  expect(stream).not.toBeNull();
  if (!stream) {
    throw new Error("Expected S3 object stream");
  }
  await expect(new Response(stream).arrayBuffer()).rejects.toThrow(
    "Unsupported S3 object body chunk type",
  );
  expect(cancelReason).toBeInstanceOf(BlobObjectStoreError);
});

test("S3 blob object store closes async iterable bodies after iteration errors", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  let returned = false;
  client.objectBodies.set("blob-stages/failed-iterable", {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          throw new Error("iterator failed");
        },
        async return(): Promise<IteratorResult<Uint8Array>> {
          returned = true;
          return { done: true, value: new Uint8Array() };
        },
      };
    },
  });

  const stream = await store.getObjectStream("blob-stages/failed-iterable");

  expect(stream).not.toBeNull();
  if (!stream) {
    throw new Error("Expected S3 object stream");
  }
  await expect(new Response(stream).text()).rejects.toThrow("iterator failed");
  expect(returned).toBe(true);
});

test("S3 blob object store closes async iterable bodies after normal completion", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  let nextCalls = 0;
  let returned = false;
  client.objectBodies.set("blob-stages/completed-iterable", {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          nextCalls += 1;
          if (nextCalls === 1) {
            return {
              done: false,
              value: new TextEncoder().encode("completed"),
            };
          }
          return { done: true, value: new Uint8Array() };
        },
        async return(): Promise<IteratorResult<Uint8Array>> {
          returned = true;
          return { done: true, value: new Uint8Array() };
        },
      };
    },
  });

  const stream = await store.getObjectStream("blob-stages/completed-iterable");

  expect(stream).not.toBeNull();
  if (!stream) {
    throw new Error("Expected S3 object stream");
  }
  await expect(new Response(stream).text()).resolves.toBe("completed");
  expect(returned).toBe(true);
});

test("S3 blob object store deletes objects and aborts multipart uploads", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  client.objects.set(
    "blob-stages/delete",
    new TextEncoder().encode("delete-me"),
  );
  const { uploadId } = await store.createMultipartUpload({
    key: "blob-stages/abort",
  });

  await store.deleteObject("blob-stages/delete");
  await store.abortMultipartUpload({
    key: "blob-stages/abort",
    uploadId,
  });

  expect(client.objects.has("blob-stages/delete")).toBe(false);
  expect(client.uploads.has(uploadId)).toBe(false);
});

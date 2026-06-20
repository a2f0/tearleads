import { expect, test } from "bun:test";
import {
  CompleteMultipartUploadCommand,
  GetObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { readBlobObjectText } from "../../test/helpers/blobObjectStore";
import {
  type CommandWithInput,
  createFakeS3BlobObjectStore,
  listPartNumbers,
  textStream,
} from "../../test/helpers/fakeS3BlobObjectStore";
import { sha256Hex } from "../utils/sha256";
import { BlobObjectStoreError } from "./blobObjectStore";

test("S3 blob object store puts a single object with a sha256 checksum", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  const bytes = "single-shot payload";

  const result = await store.putObject({
    bytes,
    key: "blob-stages/s3-put",
    sha256: await sha256Hex(bytes),
  });

  expect(result).toEqual({
    byteLength: Buffer.byteLength(bytes, "utf8"),
    sha256: await sha256Hex(bytes),
  });
  expect(
    client.commands.some((command) => command instanceof PutObjectCommand),
  ).toBe(true);
  expect(await readBlobObjectText(store, "blob-stages/s3-put")).toBe(bytes);
});

test("S3 blob object store puts an empty object like the memory store", async () => {
  const { store } = createFakeS3BlobObjectStore();

  const result = await store.putObject({
    bytes: "",
    key: "blob-stages/s3-put-empty",
    sha256: await sha256Hex(""),
  });

  expect(result).toEqual({ byteLength: 0, sha256: await sha256Hex("") });
  expect(await readBlobObjectText(store, "blob-stages/s3-put-empty")).toBe("");
});

test("S3 blob object store completes multipart uploads by part number", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  const { uploadId } = await store.createMultipartUpload({
    key: "blob-stages/s3-complete",
  });
  const secondPart = await store.uploadPart({
    body: { bytes: "-second" },
    key: "blob-stages/s3-complete",
    partNumber: 2,
    uploadId,
  });
  const firstPart = await store.uploadPart({
    body: { bytes: "first" },
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
    client.commands.some((command) => command instanceof GetObjectCommand),
  ).toBe(false);
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

test("S3 blob object store uploads streamed multipart parts", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  const key = "blob-stages/s3-streamed-part";
  const bytes = "streamed-s3-part";
  const { uploadId } = await store.createMultipartUpload({ key });
  const part = await store.uploadPart({
    body: {
      byteLength: Buffer.byteLength(bytes, "utf8"),
      sha256: await sha256Hex(bytes),
      stream: textStream(bytes),
    },
    key,
    partNumber: 1,
    uploadId,
  });

  await store.completeMultipartUpload({
    expected: {
      byteLength: Buffer.byteLength(bytes, "utf8"),
      sha256: await sha256Hex(bytes),
    },
    key,
    parts: [{ etag: part.etag, partNumber: 1 }],
    uploadId,
  });

  const uploadCommand = client.commands.find(
    (command) => command instanceof UploadPartCommand,
  ) as CommandWithInput | undefined;
  expect(typeof uploadCommand?.input.Body).not.toBe("string");
  expect(await readBlobObjectText(store, key)).toBe(bytes);
});

test("S3 blob object store follows list parts pagination", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  client.listPartsPageSize = 1;
  const { uploadId } = await store.createMultipartUpload({
    key: "blob-stages/s3-paginated-list",
  });
  await store.uploadPart({
    body: { bytes: "first" },
    key: "blob-stages/s3-paginated-list",
    partNumber: 1,
    uploadId,
  });
  await store.uploadPart({
    body: { bytes: "second" },
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
  client.objectBodies.set("blob-stages/stream", {
    transformToString: async () => {
      transformToStringCalls += 1;
      return "from-transform";
    },
    transformToWebStream: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("from-"));
          controller.enqueue(new TextEncoder().encode("stream"));
          controller.close();
        },
      }),
  });

  const stream = await store.getObjectStream("blob-stages/stream");

  expect(stream).not.toBeNull();
  if (!stream) {
    throw new Error("Expected S3 object stream");
  }
  await expect(new Response(stream).text()).resolves.toBe("from-stream");
  expect(transformToStringCalls).toBe(0);
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
        async next(): Promise<IteratorResult<string>> {
          throw new Error("iterator failed");
        },
        async return(): Promise<IteratorResult<string>> {
          returned = true;
          return { done: true, value: "" };
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

test("S3 blob object store deletes objects and aborts multipart uploads", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  client.objects.set("blob-stages/delete", "delete-me");
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

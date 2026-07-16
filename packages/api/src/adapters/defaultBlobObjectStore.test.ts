import { expect, test } from "bun:test";
import {
  blobObjectStream,
  readBlobObjectText,
} from "../../test/helpers/blobObjectStore";
import { sha256Hex } from "../utils/sha256";
import { createDefaultBlobObjectStore } from "./defaultBlobObjectStore";

test("default blob object store uses memory when unconfigured", async () => {
  const store = createDefaultBlobObjectStore({});
  const { uploadId } = await store.createMultipartUpload({
    key: "blob-stages/runtime-default",
  });
  const part = await store.uploadPart({
    body: {
      byteLength: 15,
      sha256: await sha256Hex("runtime-default"),
      stream: blobObjectStream("runtime-default"),
    },
    key: "blob-stages/runtime-default",
    partNumber: 1,
    uploadId,
  });

  const completed = await store.completeMultipartUpload({
    expected: {
      byteLength: new TextEncoder().encode("runtime-default").byteLength,
      sha256: await sha256Hex("runtime-default"),
    },
    key: "blob-stages/runtime-default",
    parts: [{ etag: part.etag, partNumber: part.partNumber }],
    uploadId,
  });

  expect(await readBlobObjectText(store, "blob-stages/runtime-default")).toBe(
    "runtime-default",
  );
  expect(completed).toEqual({
    byteLength: new TextEncoder().encode("runtime-default").byteLength,
    sha256: await sha256Hex("runtime-default"),
  });
});

test("default blob object store requires explicit production configuration", () => {
  expect(() =>
    createDefaultBlobObjectStore({ NODE_ENV: "production" }),
  ).toThrow("BLOB_OBJECT_STORE is required when NODE_ENV=production");
});

test("default blob object store rejects unknown adapters", () => {
  expect(() =>
    createDefaultBlobObjectStore({ BLOB_OBJECT_STORE: "postgres" }),
  ).toThrow("Unsupported BLOB_OBJECT_STORE value: postgres");
});

test("default blob object store requires S3 bucket and region", () => {
  expect(() =>
    createDefaultBlobObjectStore({ BLOB_OBJECT_STORE: "s3" }),
  ).toThrow(
    "BLOB_OBJECT_STORE_S3_BUCKET is required when BLOB_OBJECT_STORE=s3",
  );
  expect(() =>
    createDefaultBlobObjectStore({
      BLOB_OBJECT_STORE: "s3",
      BLOB_OBJECT_STORE_S3_BUCKET: "blob-test-bucket",
    }),
  ).toThrow(
    "BLOB_OBJECT_STORE_S3_REGION is required when BLOB_OBJECT_STORE=s3",
  );
});

test("default blob object store creates S3 adapter from env", () => {
  const store = createDefaultBlobObjectStore({
    BLOB_OBJECT_STORE: "s3",
    BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID: "test",
    BLOB_OBJECT_STORE_S3_BUCKET: "blob-test-bucket",
    BLOB_OBJECT_STORE_S3_ENDPOINT: "http://127.0.0.1:9000",
    BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE: "true",
    BLOB_OBJECT_STORE_S3_REGION: "us-east-1",
    BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY: "test",
  });

  expect(store).toHaveProperty("createMultipartUpload");
  expect(store).toHaveProperty("uploadPart");
});

test("default blob object store applies an S3 key prefix", () => {
  const store = createDefaultBlobObjectStore({
    BLOB_OBJECT_STORE: "s3",
    BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID: "test",
    BLOB_OBJECT_STORE_S3_BUCKET: "blob-test-bucket",
    BLOB_OBJECT_STORE_S3_ENDPOINT: "http://127.0.0.1:9000",
    BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE: "true",
    BLOB_OBJECT_STORE_S3_KEY_PREFIX: "dev/blobs",
    BLOB_OBJECT_STORE_S3_REGION: "us-east-1",
    BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY: "test",
  });

  expect(store).toHaveProperty("createMultipartUpload");
  expect(store).toHaveProperty("uploadPart");
});

test("default blob object store requires complete S3 credentials", () => {
  expect(() =>
    createDefaultBlobObjectStore({
      BLOB_OBJECT_STORE: "s3",
      BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID: "test",
      BLOB_OBJECT_STORE_S3_BUCKET: "blob-test-bucket",
      BLOB_OBJECT_STORE_S3_REGION: "us-east-1",
    }),
  ).toThrow(
    "Both BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID and BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY are required when either is set",
  );
});

test("default blob object store rejects invalid S3 boolean env values", () => {
  expect(() =>
    createDefaultBlobObjectStore({
      BLOB_OBJECT_STORE: "s3",
      BLOB_OBJECT_STORE_S3_BUCKET: "blob-test-bucket",
      BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE: "sometimes",
      BLOB_OBJECT_STORE_S3_REGION: "us-east-1",
    }),
  ).toThrow("Invalid boolean environment value: sometimes");
});

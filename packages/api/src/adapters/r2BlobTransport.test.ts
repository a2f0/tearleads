import { expect, test } from "bun:test";
import { UploadPartCommand } from "@aws-sdk/client-s3";
import { startFakeS3 } from "../../test/helpers/fakeS3";
import { createFakeS3BlobObjectStore } from "../../test/helpers/fakeS3BlobObjectStore";
import { sha256Hex } from "../utils/sha256";
import { createDefaultBlobObjectStore } from "./defaultBlobObjectStore";

test("R2 part integrity rejects a false SHA-256 before any storage request", async () => {
  const { client, store } = createFakeS3BlobObjectStore();
  const key = "r2-integrity";
  const { uploadId } = await store.createMultipartUpload({ key });
  const bytes = new TextEncoder().encode("actual bytes");
  await expect(
    store.uploadPart({
      key,
      uploadId,
      partNumber: 1,
      body: {
        bytes,
        byteLength: bytes.byteLength,
        sha256: sha256Hex("wrong bytes"),
      },
    }),
  ).rejects.toThrow("sha256 mismatch");
  expect(
    client.commands.filter((command) => command instanceof UploadPartCommand),
  ).toHaveLength(0);
});

test("the configured client uses R2-compatible wire checksums through completion", async () => {
  const server = startFakeS3();
  try {
    const store = createDefaultBlobObjectStore({
      BLOB_OBJECT_STORE: "s3",
      BLOB_OBJECT_STORE_S3_BUCKET: "fake",
      BLOB_OBJECT_STORE_S3_REGION: "auto",
      BLOB_OBJECT_STORE_S3_ENDPOINT: server.endpoint,
      BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE: "true",
      BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID: "test-key",
      BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY: "test-secret",
    });
    const key = "r2-wire";
    const { uploadId } = await store.createMultipartUpload({ key });
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const expected = { byteLength: bytes.byteLength, sha256: sha256Hex(bytes) };
    // The HTTP fixture rejects flexible checksum headers and missing/incorrect
    // Content-MD5, so this includes the SDK's serialization middleware.
    const part = await store.uploadPart({
      key,
      uploadId,
      partNumber: 1,
      body: { bytes, ...expected },
    });
    expect(await store.listParts({ key, uploadId })).toEqual([part]);
    expect(
      await store.completeMultipartUpload({
        key,
        uploadId,
        parts: [part],
        expected,
      }),
    ).toEqual(expected);
    expect(server.objects().get(key)).toEqual(bytes);
    await store.deleteObject(key);
    expect(server.objects().size).toBe(0);
  } finally {
    server.stop();
  }
});

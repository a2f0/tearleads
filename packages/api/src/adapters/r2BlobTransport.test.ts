import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { startFakeS3 } from "../../test/helpers/fakeS3";
import { sha256Hex } from "../utils/sha256";
import { createDefaultBlobObjectStore } from "./defaultBlobObjectStore";

test("a signed part upload and the configured client's completion use R2-compatible checksums", async () => {
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
    const contentMd5 = createHash("md5").update(bytes).digest("base64");
    const signed = await store.createUploadPartUrl?.({
      key,
      uploadId,
      partNumber: 1,
      byteLength: bytes.byteLength,
      contentMd5,
      expiresIn: 300,
    });
    if (!signed) throw new Error("Expected multipart signing support");
    // The client's PUT: the bytes go to storage, not through the API. The HTTP
    // fixture rejects flexible checksum headers and missing or wrong
    // Content-MD5, as R2 does.
    const response = await fetch(signed.url, {
      method: "PUT",
      body: bytes,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-MD5": contentMd5,
      },
    });
    expect(response.status).toBe(200);
    const etag = response.headers.get("ETag");
    if (!etag) throw new Error("Expected the part's ETag");
    const part = { byteLength: bytes.byteLength, etag, partNumber: 1 };
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

import { expect, test } from "bun:test";
import { createDefaultBlobObjectStore } from "./defaultBlobObjectStore";

test("signs the prefixed multipart identity, length and MD5 for five minutes", async () => {
  const store = createDefaultBlobObjectStore({
    BLOB_OBJECT_STORE: "s3",
    BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID: "test",
    BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY: "test",
    BLOB_OBJECT_STORE_S3_BUCKET: "private-blobs",
    BLOB_OBJECT_STORE_S3_REGION: "auto",
    BLOB_OBJECT_STORE_S3_ENDPOINT: "https://storage.example.test",
    BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE: "true",
    BLOB_OBJECT_STORE_S3_KEY_PREFIX: "/dev/blobs/",
  });
  const signed = await store.createUploadPartUrl?.({
    key: "organizations/org/blob-stages/key with spaces",
    uploadId: "upload+/id=",
    partNumber: 7,
    byteLength: 8,
    contentMd5: "AAAAAAAAAAAAAAAAAAAAAA==",
    expiresIn: 300,
  });
  if (!signed) throw new Error("Expected multipart signing support");
  const url = new URL(signed.url);
  expect(decodeURIComponent(url.pathname)).toBe(
    "/private-blobs/dev/blobs/organizations/org/blob-stages/key with spaces",
  );
  expect(url.searchParams.get("uploadId")).toBe("upload+/id=");
  expect(url.searchParams.get("partNumber")).toBe("7");
  expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
    "content-length;content-md5;host",
  );
  expect(
    [...url.searchParams.keys()].some((key) => key.includes("checksum")),
  ).toBe(false);
  expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/u);
  expect(url.searchParams.get("X-Amz-Date")).toBe(
    new Date(Date.parse(signed.expiresAt) - 300_000)
      .toISOString()
      .replace(/[-:]|\.\d{3}/gu, ""),
  );
  expect(createDefaultBlobObjectStore({}).createUploadPartUrl).toBeUndefined();
});

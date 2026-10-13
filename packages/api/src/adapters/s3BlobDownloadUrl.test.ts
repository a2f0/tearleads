import { expect, test } from "bun:test";
import { createDefaultBlobObjectStore } from "./defaultBlobObjectStore";

test("signs the configured S3 object and prefix for exactly five minutes", async () => {
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
  const signed = await store.createDownloadUrl?.({
    key: "organizations/org/blob-stages/key with spaces",
    expiresIn: 300,
  });
  expect(signed).toBeDefined();
  if (!signed) throw new Error("Expected signing support");
  const url = new URL(signed.url);
  expect(url.origin).toBe("https://storage.example.test");
  expect(decodeURIComponent(url.pathname)).toBe(
    "/private-blobs/dev/blobs/organizations/org/blob-stages/key with spaces",
  );
  expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/u);
  expect(url.searchParams.get("response-cache-control")).toBe("no-store");
  const signedAt = new Date(Date.parse(signed.expiresAt) - 300_000)
    .toISOString()
    .replace(/[-:]|\.\d{3}/gu, "");
  expect(url.searchParams.get("X-Amz-Date")).toBe(signedAt);
  expect(createDefaultBlobObjectStore({}).createDownloadUrl).toBeUndefined();
});

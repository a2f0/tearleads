import { expect, test } from "bun:test";
import {
  formatBlobStoreKeyLine,
  parseListBlobStoreKeysArgs,
  readS3BlobStoreListKeysSettings,
} from "./blobStoreKeys";

test("blob store key listing reads S3 settings from current env names", () => {
  const settings = readS3BlobStoreListKeysSettings({
    BLOB_OBJECT_STORE: "s3",
    BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID: "test-access-key",
    BLOB_OBJECT_STORE_S3_BUCKET: "blob-test-bucket",
    BLOB_OBJECT_STORE_S3_ENDPOINT: "http://127.0.0.1:3900",
    BLOB_OBJECT_STORE_S3_FORCE_PATH_STYLE: "true",
    BLOB_OBJECT_STORE_S3_REGION: "garage",
    BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY: "test-secret-key",
  });

  expect(settings.bucket).toBe("blob-test-bucket");
  expect(settings.clientConfig.region).toBe("garage");
  expect(settings.clientConfig.endpoint).toBe("http://127.0.0.1:3900");
  expect(settings.clientConfig.forcePathStyle).toBe(true);
  expect(settings.clientConfig.credentials).toEqual({
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
  });
});

test("blob store key listing requires S3 object storage", () => {
  expect(() => readS3BlobStoreListKeysSettings({})).toThrow(
    "BLOB_OBJECT_STORE must be s3 to list blob store keys",
  );
  expect(() =>
    readS3BlobStoreListKeysSettings({ BLOB_OBJECT_STORE: "memory" }),
  ).toThrow("BLOB_OBJECT_STORE must be s3 to list blob store keys");
});

test("blob store key line omits size by default", () => {
  expect(formatBlobStoreKeyLine("blobs/abc", 123, false)).toBe("blobs/abc");
});

test("blob store key line prefixes size when requested", () => {
  expect(formatBlobStoreKeyLine("blobs/abc", 123, true)).toBe("123\tblobs/abc");
});

test("blob store key line tolerates missing size when requested", () => {
  expect(formatBlobStoreKeyLine("blobs/abc", undefined, true)).toBe(
    "\tblobs/abc",
  );
});

test("blob store args default to no prefix and no size", () => {
  expect(parseListBlobStoreKeysArgs([])).toEqual({
    prefix: undefined,
    withSize: false,
  });
});

test("blob store args parse prefix and size flags in any order", () => {
  expect(
    parseListBlobStoreKeysArgs(["--prefix", "blobs/", "--with-size"]),
  ).toEqual({ prefix: "blobs/", withSize: true });
  expect(
    parseListBlobStoreKeysArgs(["--with-size", "--prefix=blobs/"]),
  ).toEqual({
    prefix: "blobs/",
    withSize: true,
  });
});

test("blob store args keep a literal --with-size used as the prefix value", () => {
  expect(parseListBlobStoreKeysArgs(["--prefix", "--with-size"])).toEqual({
    prefix: "--with-size",
    withSize: false,
  });
});

test("blob store args reject a prefix flag without a value", () => {
  expect(() => parseListBlobStoreKeysArgs(["--prefix"])).toThrow(
    "--prefix requires a value",
  );
});

test("blob store args reject unknown arguments", () => {
  expect(() => parseListBlobStoreKeysArgs(["--nope"])).toThrow(
    "Unknown argument: --nope",
  );
});

test("blob store key listing requires complete S3 credentials", () => {
  expect(() =>
    readS3BlobStoreListKeysSettings({
      BLOB_OBJECT_STORE: "s3",
      BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID: "test-access-key",
      BLOB_OBJECT_STORE_S3_BUCKET: "blob-test-bucket",
      BLOB_OBJECT_STORE_S3_REGION: "garage",
    }),
  ).toThrow(
    "Both BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID and BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY are required when either is set",
  );
});

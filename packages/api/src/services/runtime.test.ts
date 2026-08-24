import { expect, test } from "bun:test";
import { readDocumentSyncCursorHmacKey } from "./runtime";

test("document sync cursor HMAC key accepts a configured deployment secret", () => {
  const key = "a-configured-document-sync-cursor-key";
  expect(
    readDocumentSyncCursorHmacKey({
      DOCUMENT_SYNC_CURSOR_HMAC_KEY: ` ${key} `,
    }),
  ).toBe(key);
});

test("document sync cursor HMAC key rejects short configured secrets", () => {
  expect(() =>
    readDocumentSyncCursorHmacKey({
      DOCUMENT_SYNC_CURSOR_HMAC_KEY: "too-short",
    }),
  ).toThrow("DOCUMENT_SYNC_CURSOR_HMAC_KEY must be at least 32 bytes");
});

test("document sync cursor HMAC key is required in production", () => {
  expect(() =>
    readDocumentSyncCursorHmacKey({ NODE_ENV: "production" }),
  ).toThrow(
    "DOCUMENT_SYNC_CURSOR_HMAC_KEY is required when NODE_ENV=production",
  );
});

test("document sync cursor HMAC key has a deterministic nonproduction fallback", () => {
  expect(readDocumentSyncCursorHmacKey({ NODE_ENV: "test" })).toHaveLength(45);
});

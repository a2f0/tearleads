import { expect, test } from "bun:test";
import {
  readConfiguredDocumentSyncCursorHmacKey,
  readDocumentSyncCursorHmacKey,
  readTwoFactorSecretKey,
} from "./serverSecrets";

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
  expect(readDocumentSyncCursorHmacKey({ NODE_ENV: "test" })).toHaveLength(46);
});

test("no configured secret is reported as none, never the public fallback", () => {
  // Verification markers then use a per-process key a database writer cannot
  // know; returning the fixed development key would make them forgeable.
  expect(readConfiguredDocumentSyncCursorHmacKey({ NODE_ENV: "test" })).toBe(
    null,
  );
  expect(
    readConfiguredDocumentSyncCursorHmacKey({
      DOCUMENT_SYNC_CURSOR_HMAC_KEY: "   ",
      NODE_ENV: "development",
    }),
  ).toBe(null);
});

test("the two-factor key is its own secret, required in production", () => {
  const key = "a-configured-two-factor-secret-key";
  expect(
    readTwoFactorSecretKey({
      DOCUMENT_SYNC_CURSOR_HMAC_KEY: "a-configured-document-sync-cursor-key",
      TWO_FACTOR_SECRET_KEY: key,
    }),
  ).toBe(key);
  expect(() =>
    readTwoFactorSecretKey({
      DOCUMENT_SYNC_CURSOR_HMAC_KEY: "a-configured-document-sync-cursor-key",
      NODE_ENV: "production",
    }),
  ).toThrow("TWO_FACTOR_SECRET_KEY is required when NODE_ENV=production");
  expect(() =>
    readTwoFactorSecretKey({ TWO_FACTOR_SECRET_KEY: "too-short" }),
  ).toThrow("TWO_FACTOR_SECRET_KEY must be at least 32 bytes");
});

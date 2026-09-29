import { Buffer } from "node:buffer";

const DOCUMENT_SYNC_CURSOR_HMAC_KEY_ENV =
  "DOCUMENT_SYNC_CURSOR_HMAC_KEY" as const;
const DEVELOPMENT_DOCUMENT_SYNC_CURSOR_HMAC_KEY =
  "tearleads-development-document-sync-cursor-key";

/**
 * The deployment's configured server-held HMAC secret, or null when none is
 * configured outside production. Document sync cursors use it directly; other
 * uses derive independent keys from it under their own domain labels.
 */
export function readConfiguredDocumentSyncCursorHmacKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = env[DOCUMENT_SYNC_CURSOR_HMAC_KEY_ENV]?.trim();
  if (configured) {
    if (Buffer.byteLength(configured, "utf8") < 32) {
      throw new Error(
        `${DOCUMENT_SYNC_CURSOR_HMAC_KEY_ENV} must be at least 32 bytes`,
      );
    }
    return configured;
  }
  if (env.NODE_ENV?.trim() === "production") {
    throw new Error(
      `${DOCUMENT_SYNC_CURSOR_HMAC_KEY_ENV} is required when NODE_ENV=production`,
    );
  }
  return null;
}

/** The cursor HMAC secret, with a fixed development fallback. */
export function readDocumentSyncCursorHmacKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    readConfiguredDocumentSyncCursorHmacKey(env) ??
    DEVELOPMENT_DOCUMENT_SYNC_CURSOR_HMAC_KEY
  );
}

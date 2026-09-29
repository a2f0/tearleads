import { Buffer } from "node:buffer";

const DOCUMENT_SYNC_CURSOR_HMAC_KEY_ENV =
  "DOCUMENT_SYNC_CURSOR_HMAC_KEY" as const;
const DEVELOPMENT_DOCUMENT_SYNC_CURSOR_HMAC_KEY =
  "tearleads-development-document-sync-cursor-key";

/**
 * The server-held HMAC secret. Document sync cursors use it directly; other
 * uses derive independent keys from it under their own domain labels.
 */
export function readDocumentSyncCursorHmacKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
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
  return DEVELOPMENT_DOCUMENT_SYNC_CURSOR_HMAC_KEY;
}

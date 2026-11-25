import { Buffer } from "node:buffer";

const DOCUMENT_SYNC_CURSOR_HMAC_KEY_ENV =
  "DOCUMENT_SYNC_CURSOR_HMAC_KEY" as const;
const DEVELOPMENT_DOCUMENT_SYNC_CURSOR_HMAC_KEY =
  "tearleads-development-document-sync-cursor-key";
const TWO_FACTOR_SECRET_KEY_ENV = "TWO_FACTOR_SECRET_KEY" as const;
const DEVELOPMENT_TWO_FACTOR_SECRET_KEY =
  "tearleads-development-two-factor-secret-key";

/** A configured secret of at least 32 bytes; required in production. */
function readConfiguredSecret(
  name: string,
  env: NodeJS.ProcessEnv,
): string | null {
  const configured = env[name]?.trim();
  if (configured) {
    if (Buffer.byteLength(configured, "utf8") < 32) {
      throw new Error(`${name} must be at least 32 bytes`);
    }
    return configured;
  }
  if (env.NODE_ENV?.trim() === "production") {
    throw new Error(`${name} is required when NODE_ENV=production`);
  }
  return null;
}

/**
 * The deployment's configured server-held HMAC secret, or null when none is
 * configured outside production. Document sync cursors use it directly; other
 * uses derive independent keys from it under their own domain labels. It can
 * rotate: what it protects is re-verified or reissued afterwards.
 */
export function readConfiguredDocumentSyncCursorHmacKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return readConfiguredSecret(DOCUMENT_SYNC_CURSOR_HMAC_KEY_ENV, env);
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

/**
 * The secret two-factor sign-in seals authenticator secrets and keys
 * recovery-code hashes under, with a fixed development fallback. Unlike the
 * cursor key it must not rotate: stored secrets and codes cannot be
 * reissued, so rotating it turns every enrollment unusable.
 */
export function readTwoFactorSecretKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    readConfiguredSecret(TWO_FACTOR_SECRET_KEY_ENV, env) ??
    DEVELOPMENT_TWO_FACTOR_SECRET_KEY
  );
}

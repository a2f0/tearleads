import type { LocalKeyring } from "@tearleads/client-sdk";
import { LOCAL_SQLITE_SCOPE_NAMESPACE } from "../local-keyring/localKeyringScopes";

const DEVELOPMENT_SQLITE_KEY = "development-key";
const DEVELOPMENT_HOSTNAMES = new Set([
  "",
  "0.0.0.0",
  "127.0.0.1",
  "::1",
  "localhost",
]);

/**
 * Resolves the cipher key used to encrypt the local SQLite database at rest.
 *
 * Once the database is persisted to OPFS (rather than living only in memory),
 * its on-disk bytes must not be protected by a hardcoded key. We reuse the local
 * keyring — the same root of trust that already encrypts the OPFS blob store —
 * and read the session's purpose-built `sqliteKey` (a base64 key derived from the
 * keyring root under the dedicated SQLite scope).
 */
export type ResolveSqliteCipherKey = () => Promise<string>;

function allowDevelopmentSqliteKeyFallback(): boolean {
  if (typeof location !== "object") {
    return false;
  }

  return DEVELOPMENT_HOSTNAMES.has(location.hostname);
}

/**
 * Builds a cipher-key resolver from the host's local keyring.
 *
 * When a keyring is available the key is derived from it (durable, identity-bound
 * encryption of the persisted database). When no keyring is available we fall
 * back to a fixed development key, but only on local-development hosts — mirroring
 * the blob store's development fallback so production never silently runs with a
 * known key.
 */
export function createSqliteCipherKeyResolver(
  createLocalKeyring: (() => LocalKeyring) | undefined,
): ResolveSqliteCipherKey {
  if (!createLocalKeyring) {
    return async () => {
      if (!allowDevelopmentSqliteKeyFallback()) {
        throw new Error(
          "A local keyring is required to encrypt the SQLite database outside local development.",
        );
      }

      return DEVELOPMENT_SQLITE_KEY;
    };
  }

  let keyring: LocalKeyring | null = null;
  let keyDerivationQueue: Promise<void> = Promise.resolve();

  return () => {
    const operation = keyDerivationQueue.then(async () => {
      keyring ??= createLocalKeyring();
      const session = await keyring.getOrCreateSession({
        namespace: LOCAL_SQLITE_SCOPE_NAMESPACE,
      });
      try {
        return session.sqliteKey;
      } finally {
        session.dispose();
      }
    });

    keyDerivationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };
}

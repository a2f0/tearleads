import type { LocalKeyring } from "@tearleads/client-sdk";
import { LOCAL_SQLITE_SCOPE_NAMESPACE } from "../local-keyring/localKeyringScopes";

/**
 * Resolves the cipher key used to encrypt the local SQLite database at rest.
 *
 * Once the database is persisted to OPFS (rather than living only in memory),
 * its on-disk bytes must be protected by the local keyring — the same root of
 * trust that already encrypts the OPFS blob store. We read the session's
 * purpose-built `sqliteKey` (a base64 key derived from the keyring root under the
 * dedicated SQLite scope).
 */
export type ResolveSqliteCipherKey = () => Promise<string>;

/**
 * Builds a cipher-key resolver from the host's local keyring.
 *
 * When a keyring is available the key is derived from it (durable, identity-bound
 * encryption of the persisted database). When no keyring is available we FAIL
 * HARD: there is deliberately no development/hardcoded-key fallback and no silent
 * downgrade to an in-memory database.
 *
 * Why no fallback: opening a persisted, encrypted database with a key that does
 * not match the one it was created with yields `SQLITE_NOTADB` ("file is not a
 * database"). A development-key fallback *caused* that failure — a database
 * created under the dev key (keyring not yet available at create time) no longer
 * decrypts once a real keyring is present — and, because the production guard
 * only fired off-localhost while every shipping host is localhost-equivalent, it
 * masked the desync by silently encrypting with a key the keyring can never
 * reproduce. Failing hard surfaces the missing keyring loudly instead.
 */
export function createSqliteCipherKeyResolver(
  createLocalKeyring: (() => LocalKeyring) | undefined,
): ResolveSqliteCipherKey {
  if (!createLocalKeyring) {
    return async () => {
      throw new Error(
        "A local keyring is required to encrypt the persistent SQLite database. " +
          "Refusing to fall back to a development key (the database would later " +
          "fail to decrypt once a keyring becomes available).",
      );
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
      // Guard before the finally: a nullish session would otherwise make
      // session.dispose() throw a TypeError that masks the real failure.
      if (!session) {
        throw new Error("Failed to obtain a local keyring session for SQLite.");
      }
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

import type { LocalKeyring } from "@tearleads/client-sdk";
import type { LocalKeyringFactory } from "../local-keyring/localKeyringLockSupport";
import { LOCAL_SQLITE_SCOPE_NAMESPACE } from "../local-keyring/localKeyringScopes";

// Upper bound on a single keyring cipher-key derivation. Generous: a keyring
// session resolves in well under a second, so this only ever trips a genuine
// hang (a keyring/IndexedDB call that never settles), converting it into a
// rejection that lets the serialized queue advance instead of wedging.
const CIPHER_KEY_DERIVATION_TIMEOUT_MS = 15_000;

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
  createLocalKeyring: LocalKeyringFactory | undefined,
  derivationTimeoutMs = CIPHER_KEY_DERIVATION_TIMEOUT_MS,
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

  const deriveSqliteKey = async (
    activeKeyring: LocalKeyring,
  ): Promise<string> => {
    const session = await activeKeyring.getOrCreateSession({
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
  };

  return () => {
    // Bound each derivation so a keyring/IndexedDB call that never settles cannot
    // leave the queued operation pending forever. That matters because the queue
    // serializes every call: a stuck operation would otherwise block the rollback
    // to the previous identity and all later retries behind it (each then timing
    // out at the boot layer), leaving the app keyless until reload. On timeout the
    // operation rejects, its cached keyring is retired, and the queue advances
    // (the `.then(_, _)` below clears it), allowing a later retry to mint a clean
    // keyring. The message is not a worker round-trip marker, so a timeout fails
    // the boot rather than respawning the (healthy) worker.
    const operation = keyDerivationQueue.then(async () => {
      const activeKeyring = keyring ?? createLocalKeyring();
      keyring = activeKeyring;
      let timedOut = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          deriveSqliteKey(activeKeyring),
          new Promise<never>((_resolve, reject) => {
            timeoutId = setTimeout(() => {
              timedOut = true;
              reject(
                new Error(
                  `SQLite cipher key resolution timed out after ${derivationTimeoutMs}ms.`,
                ),
              );
            }, derivationTimeoutMs);
          }),
        ]);
      } catch (error) {
        if (timedOut) {
          try {
            activeKeyring.close?.();
          } catch {
            // Preserve the derivation timeout. Cache retirement below ensures a
            // replacement does not reuse this partially closed keyring.
          } finally {
            if (keyring === activeKeyring) {
              keyring = null;
              createLocalKeyring.invalidateCachedKeyring?.();
            }
          }
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    });

    keyDerivationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };
}

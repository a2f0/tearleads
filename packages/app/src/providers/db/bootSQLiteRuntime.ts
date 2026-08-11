import {
  createExecSql,
  type DatabasePersistenceMode,
  type ExecSqlClientLike,
  requestPersistentStorage,
  type SQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";
import { unknownErrorMessage } from "../../utils/unknownErrorMessage";
import { dumpDatabaseCharacteristics } from "./dumpDatabaseCharacteristics";
import type { ResolveSqliteCipherKey } from "./sqliteCipherKey";

/**
 * Upper bound on a single boot worker round-trip (database init and the
 * readability probe).
 *
 * Every runtime *teardown* path is already time-bounded, but the *boot*
 * round-trips were not — so when a new identity's database is spawned right after
 * the previous one is torn down, a teardown/respawn race in the cross-tab worker
 * layer can leave the owner worker never answering `init`. The boot promise then
 * settles to neither "ready" nor "error", `waitForReadySQLiteRuntime` waits
 * forever, and the app hangs keyless with no recovery — the Android
 * identity-creation hang (initial identity boots, creating a second stalls
 * silently). Racing each worker round-trip against this timeout turns that silent
 * hang into an ordinary boot rejection, which the managed runtime already
 * recovers from by tearing the stuck worker down and re-spawning a fresh one.
 *
 * Generous on purpose: a fresh database normally boots in well under a second, so
 * 15s never trips a slow-but-valid cold boot yet still bounds a true hang.
 */
const SQLITE_BOOT_ROUNDTRIP_TIMEOUT_MS = 15_000;

// Stable marker on the thrown message so recovery can tell a transient boot
// timeout (retryable — tear the stuck worker down and re-spawn) apart from a
// genuine init failure.
const BOOT_ROUNDTRIP_TIMEOUT_ERROR_PREFIX = "SQLite boot round-trip";

/**
 * Whether a boot error is one of the {@link withBootRoundTripTimeout} timeouts —
 * i.e. a worker round-trip that never answered, the signature of the
 * teardown/respawn race — rather than a real init/decrypt failure.
 */
export function isBootRoundTripTimeoutError(error: unknown): boolean {
  const message = unknownErrorMessage(error);
  return message.startsWith(BOOT_ROUNDTRIP_TIMEOUT_ERROR_PREFIX);
}

/**
 * Reject if `operation` has not settled within {@link SQLITE_BOOT_ROUNDTRIP_TIMEOUT_MS}.
 * The abandoned operation stays pending — harmless, the stuck worker is torn down
 * on the recovery re-spawn — while the timer is always cleared so a fast success
 * leaves nothing behind.
 */
async function withBootRoundTripTimeout<T>(
  operation: Promise<T>,
  step: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `${BOOT_ROUNDTRIP_TIMEOUT_ERROR_PREFIX}: ${step} timed out after ${SQLITE_BOOT_ROUNDTRIP_TIMEOUT_MS}ms.`,
            ),
          );
        }, SQLITE_BOOT_ROUNDTRIP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// Forces a read of page 1 (the encrypted SQLite header page) so a wrong/rotated
// cipher key surfaces NOW as SQLITE_NOTADB, while the boot promise can still
// react to it (wipe + recreate). dumpDatabaseCharacteristics below is best-effort
// and swallows errors, so it cannot be the readability gate: without this probe a
// key/db desync slips past boot and throws later — during schema creation or the first
// query — as an uncaught rejection. sqlite_master lives on page 1, so reading it
// decrypts the header and fails here on a key mismatch.
async function assertDatabaseReadable(
  client: ExecSqlClientLike,
): Promise<void> {
  const execSql = createExecSql(client);
  await execSql("SELECT count(*) FROM sqlite_master");
}

function describeBootError(
  error: unknown,
  visited = new Set<unknown>(),
): string {
  if (error instanceof Error) {
    if (visited.has(error)) {
      return "[Circular Error]";
    }
    visited.add(error);
    const cause =
      error.cause === undefined
        ? ""
        : ` (cause: ${describeBootError(error.cause, visited)})`;
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}

// Opens the SQLite database for the given name and applies the cipher key, then
// reports the mounted database's shape before features lazily create tables.
export async function bootSQLiteRuntime(
  runtime: SQLiteRuntime,
  dbName: string,
  persistence: DatabasePersistenceMode,
  resolveCipherKey: ResolveSqliteCipherKey,
  log: (message: string) => void,
) {
  const backend = persistence === "memory" ? "in-memory" : "persistent OPFS";
  log("Loading SQLite3 WASM module...");
  log(`Initializing database: ${dbName} (${backend})`);

  if (persistence !== "memory") {
    // Request durable storage BEFORE the first write. A granted persistence
    // request exempts the origin's storage bucket — the OPFS database AND its
    // sibling keyring stores (the IndexedDB wrapping key + localStorage manifest)
    // — from eviction. Eviction of the keyring while the OPFS db survives re-mints
    // a fresh root and is the primary cause of a later key/db desync
    // (SQLITE_NOTADB). Best-effort: warn but do not block boot when durability is
    // unavailable or denied, so we never brick a browser that refuses persist().
    try {
      const result = await requestPersistentStorage({
        databasePersistence: persistence,
        requestPersistentStorage: true,
      });
      if (result !== "persisted") {
        log(
          `Warning: durable storage not granted (${result}); local data and its encryption keyring may be evicted.`,
        );
      }
    } catch (error) {
      // Best-effort: a failed durability request must never block boot.
      log(
        `Warning: failed to request durable storage: ${unknownErrorMessage(error)}`,
      );
    }
  }

  let key: string;
  try {
    // resolveCipherKey bounds its own keyring derivation (see
    // createSqliteCipherKeyResolver) and rejects with a plain, non-round-trip
    // error on a keyring/IndexedDB hang — so a timeout fails the boot (the caller
    // restores the previous identity, reusing the worker) rather than triggering a
    // worker respawn, and the resolver's serialized queue advances instead of
    // stranding rollback and retries behind an abandoned operation.
    key = await resolveCipherKey();
  } catch (error) {
    log(`Failed to resolve SQLite cipher key: ${describeBootError(error)}`);
    throw error;
  }

  try {
    await withBootRoundTripTimeout(
      runtime.client.init({
        dbName,
        cipher: "chacha20",
        key,
        persistence,
      }),
      "database initialization",
    );
  } catch (error) {
    log(`Failed to initialize SQLite client: ${describeBootError(error)}`);
    throw error;
  }

  // Persistent databases decrypt their existing on-disk bytes with the resolved
  // key; verify they are readable before declaring boot a success so a key
  // mismatch is recoverable rather than fatal-later. In-memory databases are
  // freshly created and cannot be key-mismatched, so skip the probe.
  if (persistence !== "memory") {
    try {
      await withBootRoundTripTimeout(
        assertDatabaseReadable(runtime.client),
        "database readability check",
      );
    } catch (error) {
      log(`Failed to verify SQLite database: ${describeBootError(error)}`);
      throw error;
    }
  }

  // Report the mounted database's shape before features lazily create tables.
  await dumpDatabaseCharacteristics(runtime.client, log);
}

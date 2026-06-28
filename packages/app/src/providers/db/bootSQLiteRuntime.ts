import {
  createExecSql,
  type DatabasePersistenceMode,
  type ExecSqlClientLike,
  requestPersistentStorage,
  type SQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";
import { dumpDatabaseCharacteristics } from "./dumpDatabaseCharacteristics";
import type { ResolveSqliteCipherKey } from "./sqliteCipherKey";

// Forces a read of page 1 (the encrypted SQLite header page) so a wrong/rotated
// cipher key surfaces NOW as SQLITE_NOTADB, while the boot promise can still
// react to it (wipe + recreate). dumpDatabaseCharacteristics below is best-effort
// and swallows errors, so it cannot be the readability gate: without this probe a
// key/db desync slips past boot and throws later — during migrations or the first
// query — as an uncaught rejection. sqlite_master lives on page 1, so reading it
// decrypts the header and fails here on a key mismatch.
async function assertDatabaseReadable(
  client: ExecSqlClientLike,
): Promise<void> {
  const execSql = createExecSql(client);
  await execSql("SELECT count(*) FROM sqlite_master");
}

// Opens the SQLite database for the given name and applies the cipher key, then
// reports the mounted database's shape before migrations create/alter tables.
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
        `Warning: failed to request durable storage: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const key = await resolveCipherKey();
  await runtime.client.init({
    dbName,
    cipher: "chacha20",
    key,
    persistence,
  });

  // Persistent databases decrypt their existing on-disk bytes with the resolved
  // key; verify they are readable before declaring boot a success so a key
  // mismatch is recoverable rather than fatal-later. In-memory databases are
  // freshly created and cannot be key-mismatched, so skip the probe.
  if (persistence !== "memory") {
    await assertDatabaseReadable(runtime.client);
  }

  // Report the mounted database's shape before migrations create/alter tables.
  await dumpDatabaseCharacteristics(runtime.client, log);
}

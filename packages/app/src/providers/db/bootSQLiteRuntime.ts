import type {
  DatabasePersistenceMode,
  SQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";
import { dumpDatabaseCharacteristics } from "./dumpDatabaseCharacteristics";
import type { ResolveSqliteCipherKey } from "./sqliteCipherKey";

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
  const key = await resolveCipherKey();
  await runtime.client.init({
    dbName,
    cipher: "chacha20",
    key,
    persistence,
  });
  // Report the mounted database's shape before migrations create/alter tables.
  await dumpDatabaseCharacteristics(runtime.client, log);
}

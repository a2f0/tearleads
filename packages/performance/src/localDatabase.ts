import type { ExecSqlClientLike } from "@tearleads/client-sdk/sqlite";
import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";

export async function openLocalDatabase() {
  const database = await initDatabase({
    dbName: `/${crypto.randomUUID()}.db`,
    cipher: "chacha20",
    key: crypto.randomUUID(),
    persistence: "memory",
  });
  const measurements = { calls: 0, durationMs: 0 };
  const client: ExecSqlClientLike = {
    exec: async (options) => {
      const startedAt = performance.now();
      try {
        return { rows: execDatabaseStatement(database, options) };
      } finally {
        measurements.calls += 1;
        measurements.durationMs += performance.now() - startedAt;
      }
    },
  };
  return { client, measurements, close: () => database.close() };
}

import { spyOn } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { Logger } from "drizzle-orm/logger";

type QueryScope = "root" | "transaction";

export type SyncQueryEvent =
  | { readonly kind: "query"; readonly scope: QueryScope; readonly sql: string }
  | { readonly kind: "committed" | "rolledBack" };

/** Observe real SQL without proxying the transaction's identity or results. */
export async function traceSyncQueries<T>(
  database: ApiDatabase,
  run: (database: ApiDatabase) => Promise<T>,
): Promise<{ readonly events: SyncQueryEvent[]; readonly result: T }> {
  const session: unknown = Reflect.get(database, "session");
  if (typeof session !== "object" || session === null) {
    throw new Error("Expected a Drizzle session");
  }
  const logger = Reflect.get(session, "logger") as Logger;
  const logQuery = logger.logQuery.bind(logger);
  const scope = new AsyncLocalStorage<QueryScope>();
  const events: SyncQueryEvent[] = [];
  const observer = spyOn(logger, "logQuery").mockImplementation(
    (sql, params) => {
      logQuery(sql, params);
      const current = scope.getStore();
      if (current) events.push({ kind: "query", scope: current, sql });
    },
  );
  const transaction: ApiDatabase["transaction"] = async (callback, config) => {
    try {
      const result = await database.transaction(
        (tx) => scope.run("transaction", () => callback(tx)),
        config,
      );
      events.push({ kind: "committed" });
      return result;
    } catch (error) {
      events.push({ kind: "rolledBack" });
      throw error;
    }
  };
  const observed = new Proxy(database, {
    get(target, key, receiver) {
      return key === "transaction"
        ? transaction
        : Reflect.get(target, key, receiver);
    },
  });
  try {
    return { events, result: await scope.run("root", () => run(observed)) };
  } finally {
    observer.mockRestore();
  }
}

export function commitLsnEvents(events: readonly SyncQueryEvent[]) {
  return events.filter(
    (event): event is Extract<SyncQueryEvent, { kind: "query" }> =>
      event.kind === "query" && event.sql.includes("pg_current_wal_lsn()"),
  );
}

export function updateUpperBoundIndex(events: readonly SyncQueryEvent[]) {
  return events.findIndex(
    (event) =>
      event.kind === "query" &&
      event.sql.includes('order by "document_updates"."sequence" desc'),
  );
}

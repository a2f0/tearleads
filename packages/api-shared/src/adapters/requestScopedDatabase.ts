import { AsyncLocalStorage } from "node:async_hooks";
import type { ApiDatabase, ManagedApiDatabase } from "./types";

/**
 * On Workers a socket belongs to the request that opened it, so a pooled
 * connection reused by a later request never answers. This runtime gives each
 * request its own managed database for the duration of `run`, closes it once
 * `run` settles, and exposes one stable `db` handle that forwards every access
 * to the current request's database. Work outside any request scope (the
 * realtime hub's timers) falls back to the process-wide database.
 */
export interface RequestScopedDatabaseRuntime {
  readonly db: ApiDatabase;
  readonly current: () => ManagedApiDatabase;
  run<T>(
    work: () => Promise<T>,
    settle?: (closing: Promise<void>) => void,
  ): Promise<T>;
}

/** A stable database handle that forwards each access to `current()`. */
function createRequestScopedDatabaseProxy(
  fallback: ApiDatabase,
  current: () => ApiDatabase,
): ApiDatabase {
  return new Proxy(fallback, {
    get(_target, property) {
      const target = current();
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function createRequestScopedDatabaseRuntime(input: {
  readonly create: () => ManagedApiDatabase;
  readonly fallback: ManagedApiDatabase;
}): RequestScopedDatabaseRuntime {
  const scope = new AsyncLocalStorage<ManagedApiDatabase>();
  const current = () => scope.getStore() ?? input.fallback;
  return {
    current,
    db: createRequestScopedDatabaseProxy(input.fallback.db, () => current().db),
    async run(work, settle = () => {}) {
      const database = input.create();
      try {
        return await scope.run(database, work);
      } finally {
        settle(
          database.close().catch((error: unknown) => {
            console.error("Failed to close the request database:", error);
          }),
        );
      }
    },
  };
}

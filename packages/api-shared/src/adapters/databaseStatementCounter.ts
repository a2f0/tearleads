import { AsyncLocalStorage } from "node:async_hooks";

export interface DatabaseStatementCounter {
  statements: number;
  /**
   * Milliseconds spent waiting on the database driver, accumulated only when
   * the caller initializes it. A sum over driver calls: concurrent queries can
   * make it exceed the scope's wall time.
   */
  waitMs?: number;
}

interface CounterScope {
  readonly counter: DatabaseStatementCounter;
  readonly parent: CounterScope | undefined;
}

const scopes = new AsyncLocalStorage<CounterScope>();

/**
 * Count executed ORM statements without retaining SQL text or parameters.
 * PostgreSQL and SQLite include explicit transaction controls. PGlite's native
 * transaction method and Turso's transport setup are outside the ORM logger.
 */
export function withDatabaseStatementCounter<T>(
  counter: DatabaseStatementCounter,
  work: () => T,
): T {
  return scopes.run({ counter, parent: scopes.getStore() }, work);
}

export const databaseStatementLogger = {
  logQuery(): void {
    for (let scope = scopes.getStore(); scope; scope = scope.parent)
      scope.counter.statements += 1;
  },
};

const finishOutsideScope = (): void => {};

/**
 * Start timing one driver call. The scopes are captured at the call, so the
 * time is charged to the request that issued it even when the driver settles
 * it from another request's context.
 */
export function beginDatabaseWait(): () => void {
  const scope = scopes.getStore();
  if (!scope) {
    return finishOutsideScope;
  }
  const startedAt = performance.now();
  return () => {
    const elapsed = performance.now() - startedAt;
    for (
      let current: CounterScope | undefined = scope;
      current;
      current = current.parent
    ) {
      if (current.counter.waitMs !== undefined) {
        current.counter.waitMs += elapsed;
      }
    }
  };
}

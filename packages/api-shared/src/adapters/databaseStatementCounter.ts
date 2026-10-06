import { AsyncLocalStorage } from "node:async_hooks";

export interface DatabaseStatementCounter {
  statements: number;
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

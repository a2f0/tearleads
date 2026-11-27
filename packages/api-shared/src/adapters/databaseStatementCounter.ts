import { AsyncLocalStorage } from "node:async_hooks";
import { notifyDatabaseStatement } from "./databaseStatementObserverRegistry";

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
  /** Opened by `withRequestStatementCounter` around one HTTP request. */
  readonly request: boolean;
  /** What statement observers see: it groups statements and reaches nothing. */
  readonly token: object;
}

const scopes = new AsyncLocalStorage<CounterScope>();

function openScope<T>(
  counter: DatabaseStatementCounter,
  request: boolean,
  work: () => T,
): T {
  return scopes.run(
    { counter, parent: scopes.getStore(), request, token: Object.freeze({}) },
    work,
  );
}

/**
 * Count executed ORM statements without retaining SQL text or parameters.
 * PostgreSQL includes explicit transaction controls. PGlite's native
 * transaction method is outside the ORM logger.
 */
export function withDatabaseStatementCounter<T>(
  counter: DatabaseStatementCounter,
  work: () => T,
): T {
  return openScope(counter, false, work);
}

/**
 * `withDatabaseStatementCounter` for one HTTP request, as the API's
 * request-cost middleware opens it. Statement observers group statements by
 * this scope, so they tell requests apart inside any counter around them.
 */
export function withRequestStatementCounter<T>(
  counter: DatabaseStatementCounter,
  work: () => T,
): T {
  return openScope(counter, true, work);
}

/**
 * The ORM logger every API database is built with: it counts each statement
 * for the enclosing counters and hands it to any statement observer, with the
 * innermost request scope's token, or else the outermost scope's.
 */
export const databaseStatementLogger = {
  logQuery(query: string, parameters: unknown[]): void {
    let request: CounterScope | undefined;
    let outermost: CounterScope | undefined;
    for (let scope = scopes.getStore(); scope; scope = scope.parent) {
      scope.counter.statements += 1;
      if (scope.request) request ??= scope;
      outermost = scope;
    }
    notifyDatabaseStatement(query, parameters, (request ?? outermost)?.token);
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

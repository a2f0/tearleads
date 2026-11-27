import { AsyncLocalStorage } from "node:async_hooks";
import {
  hasDatabaseRequestScopeObservers,
  notifyDatabaseRequestScope,
  notifyDatabaseStatement,
} from "./databaseStatementObserverRegistry";

export interface DatabaseStatementCounter {
  statements: number;
  /**
   * Statements executed inside a managed database transaction, accumulated
   * only when the caller initializes it. Inside a transaction every statement
   * runs serially on one pinned connection.
   */
  txStatements?: number;
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
const transactionScopes = new AsyncLocalStorage<object>();

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
 * Mark a managed database transaction so counters and statement observers
 * know which statements ran serially inside one transaction, even on PGlite
 * where `BEGIN`/`COMMIT` bypass the ORM logger.
 */
export function withDatabaseTransactionScope<T>(work: () => T): T {
  return transactionScopes.run(Object.freeze({}), work);
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
 * Attach route metadata to the innermost open request scope for any registered
 * request-scope observer. A no-op with no allocation when no observer listens.
 */
export function recordRequestScopeMetadata(
  resolveMeta: () => {
    readonly method: string;
    readonly route: string;
    readonly status: number;
  },
): void {
  if (!hasDatabaseRequestScopeObservers()) return;
  for (let scope = scopes.getStore(); scope; scope = scope.parent) {
    if (scope.request) {
      notifyDatabaseRequestScope(scope.token, resolveMeta());
      return;
    }
  }
}

/**
 * The ORM logger every API database is built with: it counts each statement
 * for the enclosing counters and hands it to any statement observer, with the
 * innermost request scope's token, or else the outermost scope's.
 */
export const databaseStatementLogger = {
  logQuery(query: string, parameters: unknown[]): void {
    const transaction = transactionScopes.getStore();
    let request: CounterScope | undefined;
    let outermost: CounterScope | undefined;
    for (let scope = scopes.getStore(); scope; scope = scope.parent) {
      scope.counter.statements += 1;
      if (
        transaction !== undefined &&
        scope.counter.txStatements !== undefined
      ) {
        scope.counter.txStatements += 1;
      }
      if (scope.request) request ??= scope;
      outermost = scope;
    }
    notifyDatabaseStatement(
      query,
      parameters,
      (request ?? outermost)?.token,
      transaction,
    );
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

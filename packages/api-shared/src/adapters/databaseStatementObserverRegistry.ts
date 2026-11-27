/** One statement the ORM sent, as its logger received it. */
export interface ObservedDatabaseStatement {
  readonly sql: string;
  readonly parameters: readonly unknown[];
  /**
   * An opaque, frozen token for the HTTP request the statement ran in: the
   * innermost scope the API's request-cost middleware opened, whatever
   * counters a test opens around it. Outside every request, the outermost
   * statement counter's token, such as a test's around one workflow call;
   * undefined outside every counter.
   */
  readonly scope: object | undefined;
  /**
   * An opaque, frozen token for the enclosing managed database transaction, or
   * undefined when the statement ran on the root database outside a
   * transaction. Present on both Postgres and PGlite.
   */
  readonly transaction: object | undefined;
}

/** Route metadata for one HTTP request scope, reported when the request ends. */
export interface ObservedDatabaseRequestScope {
  readonly scope: object;
  readonly method: string;
  readonly route: string;
  readonly status: number;
}

export type DatabaseStatementObserver = (
  statement: ObservedDatabaseStatement,
) => void;

export type DatabaseRequestScopeObserver = (
  request: ObservedDatabaseRequestScope,
) => void;

const observers = new Set<DatabaseStatementObserver>();
const requestScopeObservers = new Set<DatabaseRequestScopeObserver>();

/**
 * Calls `observer` with every statement any API database sends through the
 * ORM, in this process, until the returned function is called. It is for
 * measurement harnesses such as the performance package's statement
 * capture; production registers none. An observer that throws is the
 * caller's bug, so the error reaches the statement's caller.
 */
export function observeDatabaseStatements(
  observer: DatabaseStatementObserver,
): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

/**
 * Calls `observer` when an HTTP request's statement scope finishes, with the
 * same opaque scope token seen on its statements and the matched route
 * template. Production registers none.
 */
export function observeDatabaseRequestScopes(
  observer: DatabaseRequestScopeObserver,
): () => void {
  requestScopeObservers.add(observer);
  return () => {
    requestScopeObservers.delete(observer);
  };
}

export function hasDatabaseRequestScopeObservers(): boolean {
  return requestScopeObservers.size > 0;
}

/**
 * Hands one statement to every observer. Only the ORM logger calls it; it is
 * not on the `./statement-observer` entry, so an importer cannot feed
 * observers statements the database never ran.
 */
export function notifyDatabaseStatement(
  sql: string,
  parameters: readonly unknown[],
  scope: object | undefined,
  transaction: object | undefined,
): void {
  if (observers.size === 0) return;
  const statement = { sql, parameters, scope, transaction };
  for (const observer of observers) observer(statement);
}

/** Hands one completed HTTP request's route metadata to every scope observer. */
export function notifyDatabaseRequestScope(
  scope: object,
  meta: {
    readonly method: string;
    readonly route: string;
    readonly status: number;
  },
): void {
  if (requestScopeObservers.size === 0) return;
  const event: ObservedDatabaseRequestScope = {
    scope,
    method: meta.method,
    route: meta.route,
    status: meta.status,
  };
  for (const observer of requestScopeObservers) observer(event);
}

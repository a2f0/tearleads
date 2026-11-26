/** One statement the ORM sent, as its logger received it. */
export interface ObservedDatabaseStatement {
  readonly sql: string;
  readonly parameters: readonly unknown[];
  /**
   * The outermost statement-counter scope open when the statement ran, as an
   * opaque identity, or undefined outside every counter. The API's
   * request-cost middleware opens one around each request, so unless a test
   * wraps requests in a counter of its own, this identifies the request.
   */
  readonly scope: object | undefined;
}

export type DatabaseStatementObserver = (
  statement: ObservedDatabaseStatement,
) => void;

const observers = new Set<DatabaseStatementObserver>();

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

export function notifyDatabaseStatement(
  sql: string,
  parameters: readonly unknown[],
  scope: object | undefined,
): void {
  if (observers.size === 0) return;
  const statement = { sql, parameters, scope };
  for (const observer of observers) observer(statement);
}

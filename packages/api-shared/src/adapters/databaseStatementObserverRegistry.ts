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

/**
 * Hands one statement to every observer. Only the ORM logger calls it; it is
 * not on the `./statement-observer` entry, so an importer cannot feed
 * observers statements the database never ran.
 */
export function notifyDatabaseStatement(
  sql: string,
  parameters: readonly unknown[],
  scope: object | undefined,
): void {
  if (observers.size === 0) return;
  const statement = { sql, parameters, scope };
  for (const observer of observers) observer(statement);
}

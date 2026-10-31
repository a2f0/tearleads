import {
  readUserTimingClock,
  recordUserTimingEntry,
} from "../shared/userTiming";

export type SqlRowValue = string | number | null;
export type SqlRow = Record<string, SqlRowValue>;
export type SqlArrayRow = SqlRowValue[];
export type SqlBind = Record<string, SqlRowValue> | ReadonlyArray<SqlRowValue>;
export type SqlRowMode = "object" | "array";

export interface ExecSql {
  (
    sql: string,
    bind?: SqlBind,
    options?: { rowMode?: "object" },
  ): Promise<SqlRow[]>;
  (
    sql: string,
    bind: SqlBind | undefined,
    options: { rowMode: "array" },
  ): Promise<SqlArrayRow[]>;
  (
    sql: string,
    bind?: SqlBind,
    options?: { rowMode?: SqlRowMode },
  ): Promise<Array<SqlRow | SqlArrayRow>>;
}

export interface ExecSqlClientLike {
  exec(options: {
    sql: string;
    bind?: SqlBind;
    rowMode?: SqlRowMode;
  }): Promise<{ rows: Array<SqlRow | SqlArrayRow> }>;
}

export const unavailableExecSql: ExecSql = async () => {
  throw new Error("Database client is unavailable.");
};

// Tracks the active serialized mutation chain for each canonical SQL executor
// so callers sharing one connection cannot interleave transactional statements.
const sqlMutationQueue = new WeakMap<ExecSql, Promise<void>>();

// Marks executors that already run inside the shared mutation lock so nested
// callers can reuse the current lock instead of queueing a second time.
const serializedSqlExecs = new WeakSet<ExecSql>();

// Reuses one ExecSql adapter per client so all wrappers around the same
// connection share the same serialized mutation queue.
const clientExecSqls = new WeakMap<ExecSqlClientLike, ExecSql>();

// Maps each locked executor back to the canonical executor whose lock it runs
// under, so per-connection caches key on one stable identity no matter which
// wrapper a caller holds.
const serializedSqlExecCanonicals = new WeakMap<ExecSql, ExecSql>();

export function resolveCanonicalExecSql(execSql: ExecSql): ExecSql {
  return serializedSqlExecCanonicals.get(execSql) ?? execSql;
}

// Completed once-per-connection keys (schema ensures).
// Only COMPLETED runs are recorded — never in-flight promises — so two lock
// contexts racing the same key both run the (idempotent) work instead of one
// awaiting a promise that can only settle after the lock the other context is
// already holding.
const completedConnectionOnceKeys = new WeakMap<ExecSql, Set<string>>();

// Keys first completed inside each open transaction scope on a connection,
// innermost scope last. A rolled-back scope undid that schema work, so it
// forgets exactly its own keys; a committed savepoint hands its keys to the
// enclosing scope, whose rollback would undo them too.
const transactionSchemaMemoScopes = new WeakMap<ExecSql, Set<string>[]>();

export function hasCompletedConnectionOnce(
  execSql: ExecSql,
  key: string,
): boolean {
  return (
    completedConnectionOnceKeys
      .get(resolveCanonicalExecSql(execSql))
      ?.has(key) ?? false
  );
}

export function markCompletedConnectionOnce(
  execSql: ExecSql,
  key: string,
): void {
  const canonical = resolveCanonicalExecSql(execSql);
  const keys = completedConnectionOnceKeys.get(canonical) ?? new Set<string>();
  if (keys.has(key)) return;
  keys.add(key);
  completedConnectionOnceKeys.set(canonical, keys);
  transactionSchemaMemoScopes.get(canonical)?.at(-1)?.add(key);
}

/**
 * Start recording the once-per-connection keys completed inside a transaction
 * scope (a transaction or one of its savepoints). Every open must be paired
 * with exactly one `closeTransactionSchemaMemoScope`.
 */
export function openTransactionSchemaMemoScope(execSql: ExecSql): void {
  const canonical = resolveCanonicalExecSql(execSql);
  const scopes = transactionSchemaMemoScopes.get(canonical) ?? [];
  scopes.push(new Set<string>());
  transactionSchemaMemoScopes.set(canonical, scopes);
}

/**
 * Close the innermost transaction scope. A rollback forgets only the keys
 * completed inside it, so the next query re-ensures exactly the schema the
 * rollback undid; a commit keeps them, handing them to the enclosing scope.
 */
export function closeTransactionSchemaMemoScope(
  execSql: ExecSql,
  committed: boolean,
): void {
  const canonical = resolveCanonicalExecSql(execSql);
  const scopes = transactionSchemaMemoScopes.get(canonical);
  const scopeKeys = scopes?.pop();
  if (!scopes || !scopeKeys) {
    throw new Error("No open transaction schema memo scope to close");
  }
  if (scopes.length === 0) transactionSchemaMemoScopes.delete(canonical);
  if (committed) {
    const parent = scopes.at(-1);
    for (const key of scopeKeys) parent?.add(key);
    return;
  }
  const completed = completedConnectionOnceKeys.get(canonical);
  for (const key of scopeKeys) completed?.delete(key);
}

// Completion is recorded as soon as `run` resolves. Inside a runtime
// transaction the key joins the open schema memo scope, so a later ROLLBACK
// forgets it; an explicit transaction outside the runtime must instead call
// `resetConnectionSchemaMemo` after rolling back.
export async function runOncePerConnection(
  execSql: ExecSql,
  key: string,
  run: () => Promise<void>,
): Promise<void> {
  if (hasCompletedConnectionOnce(execSql, key)) {
    return;
  }
  await run();
  markCompletedConnectionOnce(execSql, key);
}

/**
 * Forget every completed once-per-connection key for this connection. Required
 * after an operation that rebuilds the schema out from under the runtime (the
 * local backup restore drops and recreates all user tables) so the next query
 * re-runs its schema ensures.
 */
export function resetConnectionSchemaMemo(execSql: ExecSql): void {
  completedConnectionOnceKeys.delete(resolveCanonicalExecSql(execSql));
}

function defineExecSql(
  run: (
    sql: string,
    bind?: SqlBind,
    options?: { rowMode?: SqlRowMode },
  ) => Promise<Array<SqlRow | SqlArrayRow>>,
): ExecSql {
  function execSql(
    sql: string,
    bind?: SqlBind,
    options?: { rowMode?: "object" },
  ): Promise<SqlRow[]>;
  function execSql(
    sql: string,
    bind: SqlBind | undefined,
    options: { rowMode: "array" },
  ): Promise<SqlArrayRow[]>;
  function execSql(
    sql: string,
    bind?: SqlBind,
    options?: { rowMode?: SqlRowMode },
  ): Promise<Array<SqlRow | SqlArrayRow>>;
  async function execSql(
    sql: string,
    bind?: SqlBind,
    options?: { rowMode?: SqlRowMode },
  ): Promise<Array<SqlRow | SqlArrayRow>> {
    return run(sql, bind, options);
  }

  return execSql;
}

export function createExecSql(client: ExecSqlClientLike): ExecSql {
  const existingExecSql = clientExecSqls.get(client);
  if (existingExecSql) {
    return existingExecSql;
  }

  const execSql = defineExecSql(async (sql, bind, options) => {
    const result = await client.exec({
      sql,
      ...(bind !== undefined ? { bind } : {}),
      ...(options?.rowMode ? { rowMode: options.rowMode } : {}),
    });
    return result.rows;
  });

  clientExecSqls.set(client, execSql);
  return execSql;
}

function isSerializedSqlExec(execSql: ExecSql): boolean {
  return serializedSqlExecs.has(execSql);
}

function createSerializedSqlExec(execSql: ExecSql): ExecSql {
  if (isSerializedSqlExec(execSql)) {
    return execSql;
  }

  const serializedExecSql = defineExecSql(execSql);
  serializedSqlExecs.add(serializedExecSql);
  serializedSqlExecCanonicals.set(
    serializedExecSql,
    resolveCanonicalExecSql(execSql),
  );
  return serializedExecSql;
}

// SQLite transactions are scoped to the shared connection, so we must hold a
// connection-level lock across multi-statement mutations to prevent interleaving.
// Nested callers must keep passing the provided locked executor. Re-entering
// with the original canonical executor will wait on the current mutation and
// deadlock.
// Each outermost mutation is drawn on DevTools tracks: time spent queued
// behind another mutation, then time holding the lock.
export async function runSerializedSqlMutation<T>(
  execSql: ExecSql,
  operation: (execSql: ExecSql) => Promise<T> | T,
): Promise<T> {
  if (isSerializedSqlExec(execSql)) {
    return operation(execSql);
  }

  const queuedAtMs = readUserTimingClock();
  const previous = sqlMutationQueue.get(execSql);
  let releaseCurrent = () => {};
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const waitForPrevious = (previous ?? Promise.resolve()).catch(
    () => undefined,
  );
  const queuedCurrent = waitForPrevious.then(() => current);

  sqlMutationQueue.set(execSql, queuedCurrent);
  await waitForPrevious;
  const acquiredAtMs = readUserTimingClock();
  if (previous) {
    recordUserTimingEntry({
      endMs: acquiredAtMs,
      name: "SQLite mutation wait",
      startMs: queuedAtMs,
      track: "SQLite mutation queue",
    });
  }

  let failed = true;
  try {
    const result = await operation(createSerializedSqlExec(execSql));
    failed = false;
    return result;
  } finally {
    const releasedAtMs = readUserTimingClock();
    releaseCurrent();
    if (sqlMutationQueue.get(execSql) === queuedCurrent) {
      sqlMutationQueue.delete(execSql);
    }
    recordUserTimingEntry({
      endMs: releasedAtMs,
      failed,
      name: "SQLite mutation",
      startMs: acquiredAtMs,
      track: "SQLite mutations",
    });
  }
}

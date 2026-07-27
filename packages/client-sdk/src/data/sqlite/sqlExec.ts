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

function resolveCanonicalExecSql(execSql: ExecSql): ExecSql {
  return serializedSqlExecCanonicals.get(execSql) ?? execSql;
}

// Completed once-per-connection keys (schema ensures).
// Only COMPLETED runs are recorded — never in-flight promises — so two lock
// contexts racing the same key both run the (idempotent) work instead of one
// awaiting a promise that can only settle after the lock the other context is
// already holding.
const completedConnectionOnceKeys = new WeakMap<ExecSql, Set<string>>();

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
  keys.add(key);
  completedConnectionOnceKeys.set(canonical, keys);
}

// Callers must not invoke this inside an explicit SQL transaction that can
// roll back: completion is recorded as soon as `run` resolves, so a later
// ROLLBACK would leave the memo asserting schema that no longer exists.
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
export async function runSerializedSqlMutation<T>(
  execSql: ExecSql,
  operation: (execSql: ExecSql) => Promise<T> | T,
): Promise<T> {
  if (isSerializedSqlExec(execSql)) {
    return operation(execSql);
  }

  const previous = sqlMutationQueue.get(execSql) ?? Promise.resolve();
  let releaseCurrent = () => {};
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const waitForPrevious = previous.catch(() => undefined);
  const queuedCurrent = waitForPrevious.then(() => current);

  sqlMutationQueue.set(execSql, queuedCurrent);
  await waitForPrevious;

  try {
    return await operation(createSerializedSqlExec(execSql));
  } finally {
    releaseCurrent();
    if (sqlMutationQueue.get(execSql) === queuedCurrent) {
      sqlMutationQueue.delete(execSql);
    }
  }
}

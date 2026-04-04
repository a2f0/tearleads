export type SqlRowValue = string | number | null;
export type SqlRow = Record<string, SqlRowValue>;

export type ExecSql = (
  sql: string,
  bind?: Record<string, SqlRowValue>,
) => Promise<SqlRow[]>;

export interface SqlTableSchema {
  name: string;
  createSql: string;
}

const sqlMutationQueue = new WeakMap<ExecSql, Promise<void>>();
const serializedSqlExecs = new WeakSet<ExecSql>();
const serializedSqlRoots = new WeakMap<ExecSql, ExecSql>();

export function readSqlRowValue(
  row: SqlRow,
  key: string,
): SqlRowValue | undefined {
  return row[key];
}

function isSerializedSqlExec(execSql: ExecSql): boolean {
  return serializedSqlExecs.has(execSql);
}

function getSqlMutationRoot(execSql: ExecSql): ExecSql {
  return serializedSqlRoots.get(execSql) ?? execSql;
}

function createSerializedSqlExec(execSql: ExecSql): ExecSql {
  if (isSerializedSqlExec(execSql)) {
    return execSql;
  }

  const rootExecSql = getSqlMutationRoot(execSql);
  const serializedExecSql: ExecSql = async (sql, bind) =>
    rootExecSql(sql, bind);

  serializedSqlExecs.add(serializedExecSql);
  serializedSqlRoots.set(serializedExecSql, rootExecSql);
  return serializedExecSql;
}

// SQLite transactions are scoped to the shared connection, so we must hold a
// connection-level lock across multi-statement mutations to prevent interleaving.
// Nested callers must keep passing the provided locked executor. Re-entering
// with the original root executor will wait on the current mutation and deadlock.
export async function runSerializedSqlMutation<T>(
  execSql: ExecSql,
  operation: (execSql: ExecSql) => Promise<T> | T,
): Promise<T> {
  if (isSerializedSqlExec(execSql)) {
    return operation(execSql);
  }

  const rootExecSql = getSqlMutationRoot(execSql);
  const previous = sqlMutationQueue.get(rootExecSql) ?? Promise.resolve();
  let releaseCurrent = () => {};
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const waitForPrevious = previous.catch(() => undefined);
  const queuedCurrent = waitForPrevious.then(() => current);

  sqlMutationQueue.set(rootExecSql, queuedCurrent);
  await waitForPrevious;

  try {
    return await operation(createSerializedSqlExec(rootExecSql));
  } finally {
    releaseCurrent();
    if (sqlMutationQueue.get(rootExecSql) === queuedCurrent) {
      sqlMutationQueue.delete(rootExecSql);
    }
  }
}

export async function ensureSqlTables(
  execSql: ExecSql,
  tables: ReadonlyArray<SqlTableSchema>,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    for (const table of tables) {
      await lockedExecSql(table.createSql);
    }
  });
}

export async function runSqlTransaction<T>(
  execSql: ExecSql,
  operation: () => Promise<T>,
): Promise<T> {
  await execSql("BEGIN");

  try {
    const result = await operation();
    await execSql("COMMIT");
    return result;
  } catch (error) {
    try {
      await execSql("ROLLBACK");
    } catch {
      // Ignore rollback errors so callers see the original failure.
    }

    throw error;
  }
}

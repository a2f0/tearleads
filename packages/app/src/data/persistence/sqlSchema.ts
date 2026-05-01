export type SqlRowValue = string | number | null;
export type SqlRow = Record<string, SqlRowValue>;

export type ExecSql = (
  sql: string,
  bind?: Record<string, SqlRowValue>,
) => Promise<SqlRow[]>;

interface ExecSqlClientLike {
  exec(options: {
    sql: string;
    bind?: Record<string, SqlRowValue>;
  }): Promise<{ rows: SqlRow[] }>;
}

export interface SqlTableSchema {
  name: string;
  createSql: string;
  indexes?: ReadonlyArray<string>;
}

// Tracks the active serialized mutation chain for each canonical SQL executor
// so callers sharing one connection cannot interleave transactional statements.
const sqlMutationQueue = new WeakMap<ExecSql, Promise<void>>();

// Marks executors that already run inside the shared mutation lock so nested
// callers can reuse the current lock instead of queueing a second time.
const serializedSqlExecs = new WeakSet<ExecSql>();

// Reuses one ExecSql adapter per client so all wrappers around the same
// connection share the same serialized mutation queue.
const clientExecSqls = new WeakMap<ExecSqlClientLike, ExecSql>();

export function readSqlRowValue(
  row: SqlRow,
  key: string,
): SqlRowValue | undefined {
  return row[key];
}

export function createExecSql(client: ExecSqlClientLike): ExecSql {
  const existingExecSql = clientExecSqls.get(client);
  if (existingExecSql) {
    return existingExecSql;
  }

  const execSql: ExecSql = async (sql, bind) => {
    const result = await client.exec(bind ? { sql, bind } : { sql });
    return result.rows;
  };
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

  const serializedExecSql: ExecSql = async (sql, bind) => execSql(sql, bind);

  serializedSqlExecs.add(serializedExecSql);
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

export async function ensureSqlTables(
  execSql: ExecSql,
  tables: ReadonlyArray<SqlTableSchema>,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    for (const table of tables) {
      await lockedExecSql(table.createSql);
      for (const indexSql of table.indexes ?? []) {
        await lockedExecSql(indexSql);
      }
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

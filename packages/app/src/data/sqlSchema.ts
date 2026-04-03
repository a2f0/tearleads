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

const sqlMutationLockedSymbol = Symbol("sqlMutationLocked");
const sqlMutationRootSymbol = Symbol("sqlMutationRoot");
const sqlMutationQueue = new WeakMap<ExecSql, Promise<void>>();

type SerializedExecSql = ExecSql & {
  [sqlMutationLockedSymbol]?: true;
  [sqlMutationRootSymbol]?: ExecSql;
};

export function readSqlRowValue(
  row: SqlRow,
  key: string,
): SqlRowValue | undefined {
  return row[key];
}

function isSerializedSqlExec(execSql: ExecSql): execSql is SerializedExecSql {
  return (
    (execSql as SerializedExecSql)[sqlMutationLockedSymbol] === true &&
    typeof (execSql as SerializedExecSql)[sqlMutationRootSymbol] === "function"
  );
}

function getSqlMutationRoot(execSql: ExecSql): ExecSql {
  return isSerializedSqlExec(execSql)
    ? execSql[sqlMutationRootSymbol]
    : execSql;
}

function createSerializedSqlExec(execSql: ExecSql): ExecSql {
  if (isSerializedSqlExec(execSql)) {
    return execSql;
  }

  const rootExecSql = getSqlMutationRoot(execSql);
  const serializedExecSql = (async (sql, bind) =>
    rootExecSql(sql, bind)) as SerializedExecSql;

  serializedExecSql[sqlMutationLockedSymbol] = true;
  serializedExecSql[sqlMutationRootSymbol] = rootExecSql;
  return serializedExecSql;
}

// SQLite transactions are scoped to the shared connection, so we must hold a
// connection-level lock across multi-statement mutations to prevent interleaving.
export async function runSerializedSqlMutation<T>(
  execSql: ExecSql,
  operation: (execSql: ExecSql) => Promise<T> | T,
): Promise<T> {
  if (isSerializedSqlExec(execSql)) {
    return operation(execSql);
  }

  const rootExecSql = getSqlMutationRoot(execSql);
  const previous = sqlMutationQueue.get(rootExecSql) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = previous.then(
    () =>
      new Promise<void>((resolve) => {
        releaseCurrent = resolve;
      }),
  );

  sqlMutationQueue.set(rootExecSql, current);
  await previous;

  try {
    return await operation(createSerializedSqlExec(rootExecSql));
  } finally {
    releaseCurrent();
    if (sqlMutationQueue.get(rootExecSql) === current) {
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

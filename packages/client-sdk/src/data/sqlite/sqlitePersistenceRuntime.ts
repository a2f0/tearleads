import type {
  RemoteCallback,
  SqliteRemoteDatabase,
} from "drizzle-orm/sqlite-proxy";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { clientSQLiteSchema } from "./schema";
import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
  resolveCanonicalExecSql,
  runSerializedSqlMutation,
  type SqlArrayRow,
  type SqlRowValue,
} from "./sqlSchema";

export type ClientSQLiteSchema = typeof clientSQLiteSchema;
export type ClientSQLiteDatabase = SqliteRemoteDatabase<ClientSQLiteSchema>;
export type ClientSQLiteTransaction = Parameters<
  Parameters<ClientSQLiteDatabase["transaction"]>[0]
>[0];
export type ClientSQLiteTransactionConfig = NonNullable<
  Parameters<ClientSQLiteDatabase["transaction"]>[1]
>;

export interface ClientSQLitePersistenceRuntime {
  db: ClientSQLiteDatabase;
  execSql: ExecSql;
  runMutation<T>(
    operation: (db: ClientSQLiteDatabase) => Promise<T> | T,
  ): Promise<T>;
  transaction<T>(
    operation: (tx: ClientSQLiteTransaction) => Promise<T>,
    config?: ClientSQLiteTransactionConfig,
  ): Promise<T>;
}

const runtimeByExecSql = new WeakMap<ExecSql, ClientSQLitePersistenceRuntime>();
// One transaction depth per underlying connection (canonical executor), so a
// runtime.transaction call made while another transaction is already open on
// the same connection degrades to a SAVEPOINT scope instead of issuing a
// second BEGIN. Callers inside a serialized mutation get separate runtime
// instances per locked executor, so the depth cannot live on the runtime.
const transactionDepthByCanonicalExecSql = new WeakMap<ExecSql, number>();
const execSqlByClient = new WeakMap<ExecSqlClientLike, ExecSql>();

function toSqlRowValue(value: unknown): SqlRowValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  throw new Error(`Unsupported SQLite bind value: ${String(value)}`);
}

function createRemoteCallback(getExecSql: () => ExecSql): RemoteCallback {
  type RemoteResult = Awaited<ReturnType<RemoteCallback>>;

  function getRemoteResult(rows: readonly SqlArrayRow[]): RemoteResult {
    const row = rows[0];
    if (row !== undefined) {
      return { rows: row } satisfies RemoteResult;
    }

    // Drizzle's RemoteCallback type requires rows, but sqlite-proxy's get()
    // mapper treats an undefined rows value as "no row found".
    return Object.defineProperty({ rows: [] } satisfies RemoteResult, "rows", {
      enumerable: true,
      value: undefined,
    });
  }

  return async (sql, params, method) => {
    const rows = await getExecSql()(sql, params.map(toSqlRowValue), {
      rowMode: "array",
    });

    if (method === "get") {
      return getRemoteResult(rows);
    }

    return { rows } satisfies RemoteResult;
  };
}

function createClientSQLiteDatabase(
  getExecSql: () => ExecSql,
): ClientSQLiteDatabase {
  return drizzle(createRemoteCallback(getExecSql), {
    schema: clientSQLiteSchema,
  });
}

function createRuntimeForExecSql(
  execSql: ExecSql,
): ClientSQLitePersistenceRuntime {
  let activeExecSql = execSql;
  const db = createClientSQLiteDatabase(() => activeExecSql);

  async function withActiveExecSql<T>(
    nextExecSql: ExecSql,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const previousExecSql = activeExecSql;
    activeExecSql = nextExecSql;

    try {
      return await operation();
    } finally {
      activeExecSql = previousExecSql;
    }
  }

  const runtime: ClientSQLitePersistenceRuntime = {
    db,
    execSql,
    runMutation(operation) {
      return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
        withActiveExecSql(lockedExecSql, () => operation(db)),
      );
    },
    transaction(operation, config) {
      return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
        withActiveExecSql(lockedExecSql, async () => {
          const canonical = resolveCanonicalExecSql(execSql);
          const depth = transactionDepthByCanonicalExecSql.get(canonical) ?? 0;
          transactionDepthByCanonicalExecSql.set(canonical, depth + 1);
          try {
            if (depth === 0) {
              return await db.transaction(operation, config);
            }

            // Nested inside an open transaction on this connection: a second
            // BEGIN would throw, so scope this call to a SAVEPOINT. The
            // drizzle handle shares the transaction's connection and query
            // interface, and no caller uses tx.rollback or tx.transaction,
            // so the database handle stands in for the transaction handle.
            const savepoint = `runtime_transaction_sp_${depth}`;
            await lockedExecSql(`SAVEPOINT ${savepoint}`);
            try {
              const result = await operation(
                db as unknown as ClientSQLiteTransaction,
              );
              await lockedExecSql(`RELEASE SAVEPOINT ${savepoint}`);
              return result;
            } catch (error: unknown) {
              await lockedExecSql(`ROLLBACK TO SAVEPOINT ${savepoint}`);
              await lockedExecSql(`RELEASE SAVEPOINT ${savepoint}`);
              throw error;
            }
          } finally {
            if (depth === 0) {
              transactionDepthByCanonicalExecSql.delete(canonical);
            } else {
              transactionDepthByCanonicalExecSql.set(canonical, depth);
            }
          }
        }),
      );
    },
  };

  runtimeByExecSql.set(execSql, runtime);
  return runtime;
}

export function getClientSQLitePersistenceRuntime(
  execSql: ExecSql,
): ClientSQLitePersistenceRuntime {
  return runtimeByExecSql.get(execSql) ?? createRuntimeForExecSql(execSql);
}

export function createClientSQLitePersistenceRuntime(
  client: ExecSqlClientLike,
): ClientSQLitePersistenceRuntime {
  let execSql = execSqlByClient.get(client);
  if (!execSql) {
    execSql = createExecSql(client);
    execSqlByClient.set(client, execSql);
  }

  return getClientSQLitePersistenceRuntime(execSql);
}

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
export type ClientSQLiteTransactionConfig = NonNullable<
  Parameters<ClientSQLiteDatabase["transaction"]>[1]
>;
/**
 * The handle a runtime transaction callback receives: the transaction's
 * query interface WITHOUT `rollback` (throw instead — every scope maps an
 * exception to its own rollback) and WITHOUT `transaction` (nest by calling
 * `runtime.transaction` again, which scopes to a savepoint). Narrowing the
 * contract here is what lets a nested scope share the connection-backed
 * database handle safely.
 */
export type ClientSQLiteTransactionScope = Pick<
  ClientSQLiteDatabase,
  | "all"
  | "delete"
  | "get"
  | "insert"
  | "query"
  | "run"
  | "select"
  | "selectDistinct"
  | "update"
  | "values"
>;

export interface ClientSQLitePersistenceRuntime {
  db: ClientSQLiteDatabase;
  execSql: ExecSql;
  runMutation<T>(
    operation: (db: ClientSQLiteDatabase) => Promise<T> | T,
  ): Promise<T>;
  transaction<T>(
    operation: (tx: ClientSQLiteTransactionScope) => Promise<T>,
    config?: ClientSQLiteTransactionConfig,
  ): Promise<T>;
  /**
   * A transaction whose commit is gated on a SYNCHRONOUS guard: the guard
   * runs and — when it passes — the COMMIT is dispatched in the same
   * synchronous slice, so no JavaScript (an identity replacement included)
   * can interleave between the decision and the commit dispatch. Resolves
   * with `committed: false` (all writes rolled back) when the guard refuses.
   */
  guardedTransaction<T>(
    operation: (tx: ClientSQLiteTransactionScope) => Promise<T>,
    canCommit: () => boolean,
  ): Promise<{ committed: boolean; result: T | null }>;
}

const runtimeByExecSql = new WeakMap<ExecSql, ClientSQLitePersistenceRuntime>();
// One transaction depth per underlying connection (canonical executor), so a
// runtime.transaction call made while another transaction is already open on
// the same connection degrades to a SAVEPOINT scope instead of issuing a
// second BEGIN. Callers inside a serialized mutation get separate runtime
// instances per locked executor, so the depth cannot live on the runtime.
const transactionDepthByCanonicalExecSql = new WeakMap<ExecSql, number>();
// Sibling nested scopes on one connection must not interleave: SQLite
// savepoints form a stack, so releasing an earlier savepoint would also
// release a later one started concurrently. Each connection serializes its
// nested scopes through this promise chain.
const nestedScopeChainByCanonicalExecSql = new WeakMap<
  ExecSql,
  Promise<unknown>
>();
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

// Serialize one nested savepoint scope per connection: siblings queue on the
// connection's chain so their savepoints strictly nest instead of
// interleaving on the shared stack.
async function runNestedSavepointScope<T>(
  canonical: ExecSql,
  lockedExecSql: ExecSql,
  operation: () => Promise<T>,
): Promise<T> {
  const previous =
    nestedScopeChainByCanonicalExecSql.get(canonical) ?? Promise.resolve();
  const scope = previous
    .catch(() => undefined)
    .then(async () => {
      const depth = transactionDepthByCanonicalExecSql.get(canonical) ?? 0;
      transactionDepthByCanonicalExecSql.set(canonical, depth + 1);
      const savepoint = `runtime_transaction_sp_${depth}`;
      await lockedExecSql(`SAVEPOINT ${savepoint}`);
      try {
        const result = await operation();
        await lockedExecSql(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error: unknown) {
        await lockedExecSql(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await lockedExecSql(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      } finally {
        transactionDepthByCanonicalExecSql.set(canonical, depth);
      }
    });
  nestedScopeChainByCanonicalExecSql.set(
    canonical,
    scope.catch(() => undefined),
  );
  return scope;
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
          if ((transactionDepthByCanonicalExecSql.get(canonical) ?? 0) > 0) {
            return runNestedSavepointScope(canonical, lockedExecSql, () =>
              operation(db),
            );
          }

          transactionDepthByCanonicalExecSql.set(canonical, 1);
          try {
            return await db.transaction(operation, config);
          } finally {
            transactionDepthByCanonicalExecSql.delete(canonical);
          }
        }),
      );
    },
    guardedTransaction(operation, canCommit) {
      return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
        withActiveExecSql(lockedExecSql, async () => {
          const canonical = resolveCanonicalExecSql(execSql);
          if ((transactionDepthByCanonicalExecSql.get(canonical) ?? 0) > 0) {
            throw new Error(
              "guardedTransaction cannot nest inside an open transaction",
            );
          }

          transactionDepthByCanonicalExecSql.set(canonical, 1);
          await lockedExecSql("BEGIN");
          try {
            const result = await operation(db);
            if (!canCommit()) {
              await lockedExecSql("ROLLBACK");
              return { committed: false, result: null };
            }
            // The guard passed in THIS synchronous slice and the COMMIT is
            // dispatched in the same slice: no JavaScript can run between
            // the two, so the decision cannot go stale before dispatch. (A
            // host tearing the connection down concurrently is resolved by
            // SQLite's own commit atomicity, not by anything client-side.)
            const commit = lockedExecSql("COMMIT");
            await commit;
            return { committed: true, result };
          } catch (error: unknown) {
            await lockedExecSql("ROLLBACK").catch(() => undefined);
            throw error;
          } finally {
            transactionDepthByCanonicalExecSql.delete(canonical);
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

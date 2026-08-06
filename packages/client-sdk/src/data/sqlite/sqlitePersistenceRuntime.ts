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
  resetConnectionSchemaMemo,
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
// release a later sibling started concurrently. Scopes serialize per
// NESTING DEPTH — siblings share a depth and queue behind each other, while
// a descendant runs one level deeper and must NOT wait on its own enclosing
// scope (that wait can never resolve).
const nestedScopeChainsByCanonicalExecSql = new WeakMap<
  ExecSql,
  Map<number, Promise<unknown>>
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

// Serialize nested savepoint scopes per connection AND depth: a sibling
// (same depth) queues behind the previous sibling so their savepoints
// strictly nest instead of interleaving on the shared stack, while a
// descendant (called from inside an executing scope, so one level deeper)
// starts on its own depth's chain and never waits on its unresolved parent.
async function runNestedSavepointScope<T>(
  canonical: ExecSql,
  lockedExecSql: ExecSql,
  operation: () => Promise<T>,
): Promise<T> {
  const depthAtEntry = transactionDepthByCanonicalExecSql.get(canonical) ?? 0;
  const chains =
    nestedScopeChainsByCanonicalExecSql.get(canonical) ??
    new Map<number, Promise<unknown>>();
  nestedScopeChainsByCanonicalExecSql.set(canonical, chains);
  const previous = chains.get(depthAtEntry) ?? Promise.resolve();
  let tracked: Promise<unknown> = Promise.resolve();
  const scope = previous
    .catch(() => undefined)
    .then(async () => {
      const depth = transactionDepthByCanonicalExecSql.get(canonical) ?? 0;
      transactionDepthByCanonicalExecSql.set(canonical, depth + 1);
      const savepoint = `runtime_transaction_sp_${depth}`;
      try {
        await lockedExecSql(`SAVEPOINT ${savepoint}`);
        const result = await operation();
        await lockedExecSql(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error: unknown) {
        await lockedExecSql(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(
          () => undefined,
        );
        await lockedExecSql(`RELEASE SAVEPOINT ${savepoint}`).catch(
          () => undefined,
        );
        resetConnectionSchemaMemo(canonical);
        throw error;
      } finally {
        transactionDepthByCanonicalExecSql.set(canonical, depth);
        if (chains.get(depthAtEntry) === tracked) {
          chains.delete(depthAtEntry);
        }
      }
    });
  tracked = scope.catch(() => undefined);
  chains.set(depthAtEntry, tracked);
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
      // A caller already inside an open transaction on this connection MUST
      // reach us through the transaction's locked executor (the runtime that
      // executor resolves to detects the open transaction below and joins it
      // as a savepoint scope). Re-entering through the canonical executor
      // queues here for full isolation — the contract every persistence
      // helper follows by passing its received locked executor down.
      const canonical = resolveCanonicalExecSql(execSql);
      return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
        withActiveExecSql(lockedExecSql, async () => {
          if ((transactionDepthByCanonicalExecSql.get(canonical) ?? 0) > 0) {
            return runNestedSavepointScope(canonical, lockedExecSql, () =>
              operation(db),
            );
          }

          transactionDepthByCanonicalExecSql.set(canonical, 1);
          try {
            return await db.transaction(operation, config);
          } catch (error: unknown) {
            // The rollback undid any DDL this transaction ran, but the
            // per-connection ensure memo still claims it exists — reset it
            // so later operations re-ensure instead of hitting missing
            // tables.
            resetConnectionSchemaMemo(canonical);
            throw error;
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
          try {
            await lockedExecSql("BEGIN");
            const result = await operation(db);
            if (!canCommit()) {
              await lockedExecSql("ROLLBACK");
              resetConnectionSchemaMemo(canonical);
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
            resetConnectionSchemaMemo(canonical);
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
